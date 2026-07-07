import { addDays, addMinutes, isBefore, isEqual } from 'date-fns';
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';
import { env } from '../config/env.js';
import { ApiError, assertFound } from '../errors.js';
import type { GoogleCalendarClient } from '../integrations/googleCalendar.js';
import type { BookingRepository } from '../repositories/bookingRepository.js';
import type { Service, TimeRange } from '../types/domain.js';

export type AvailabilitySlot = {
  startsAt: string;
  endsAt: string;
  timezone: string;
};

export type AvailabilitySlotDiagnostic = AvailabilitySlot & {
  localDate: string;
  dayOfWeek: number;
  ruleId: string;
  available: boolean;
  reasons: string[];
  blockedBy: Array<'blackout' | 'preReservation' | 'googleCalendar'>;
};

export type AvailabilityDiagnostics = {
  service: Pick<Service, 'id' | 'name' | 'duration_minutes' | 'buffer_before_minutes' | 'buffer_after_minutes' | 'active'>;
  range: {
    from: string;
    to: string;
    timezone: string;
    localDates: string[];
  };
  counts: {
    activeRules: number;
    matchingRules: number;
    blackouts: number;
    preReservations: number;
    googleBusy: number;
    candidates: number;
    available: number;
  };
  candidates: AvailabilitySlotDiagnostic[];
  slots: AvailabilitySlot[];
};

export class AvailabilityService {
  constructor(
    private readonly repository: BookingRepository,
    private readonly googleCalendar: GoogleCalendarClient
  ) {}

  async listSlots(serviceId: string, fromIso: string, toIso: string, timezone = env.GOOGLE_TIMEZONE): Promise<AvailabilitySlot[]> {
    return (await this.buildAvailability(serviceId, fromIso, toIso, timezone, false)).slots;
  }

  async diagnoseSlots(serviceId: string, fromIso: string, toIso: string, timezone = env.GOOGLE_TIMEZONE): Promise<AvailabilityDiagnostics> {
    const diagnostics = await this.buildAvailability(serviceId, fromIso, toIso, timezone, true);
    if (!diagnostics.details) {
      throw new ApiError(500, 'availability_diagnostics_unavailable', 'Availability diagnostics could not be generated');
    }
    return diagnostics.details;
  }

  async assertSlotAvailable(service: Service, startsAtIso: string, timezone: string): Promise<{ startsAt: string; endsAt: string }> {
    const startsAt = new Date(startsAtIso);
    const endsAt = addMinutes(startsAt, service.duration_minutes);
    const slots = await this.listSlots(
      service.id,
      addMinutes(startsAt, -service.duration_minutes).toISOString(),
      addMinutes(endsAt, service.duration_minutes).toISOString(),
      timezone
    );
    const match = slots.find((slot) => slot.startsAt === startsAt.toISOString());
    if (!match) {
      throw new ApiError(409, 'slot_unavailable', 'The requested slot is no longer available');
    }
    return { startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString() };
  }

  private async buildAvailability(
    serviceId: string,
    fromIso: string,
    toIso: string,
    timezone: string,
    includeDiagnostics: boolean
  ): Promise<{ slots: AvailabilitySlot[]; details?: AvailabilityDiagnostics }> {
    const service = assertFound(await this.repository.getService(serviceId), 'Service not found');
    if (!service.active) {
      throw new ApiError(400, 'inactive_service', 'Service is not active');
    }

    const from = new Date(fromIso);
    const to = new Date(toIso);
    if (!isBefore(from, to)) {
      throw new ApiError(400, 'invalid_range', '`from` must be before `to`');
    }

    const [rules, blackouts, holds, googleBusy] = await Promise.all([
      this.repository.listAvailabilityRules(),
      this.repository.listBlackouts(from.toISOString(), to.toISOString()),
      this.repository.listBlockingPreReservations(from.toISOString(), to.toISOString()),
      this.googleCalendar.freeBusy(from, to)
    ]);

    const occupied: Array<TimeRange & { source: 'blackout' | 'preReservation' | 'googleCalendar' }> = [
      ...blackouts.map((blackout) => ({
        start: new Date(blackout.starts_at),
        end: new Date(blackout.ends_at),
        source: 'blackout' as const
      })),
      ...holds.map((hold) => ({
        start: new Date(hold.starts_at),
        end: new Date(hold.ends_at),
        source: 'preReservation' as const
      })),
      ...googleBusy.map((busy) => ({ ...busy, source: 'googleCalendar' as const }))
    ];

    const slots: AvailabilitySlot[] = [];
    const candidates: AvailabilitySlotDiagnostic[] = [];
    const matchingRuleIds = new Set<string>();
    const localDates = localDatesInRange(from, to, timezone);
    for (const localDate of localDates) {
      const dayOfWeek = dayOfWeekForLocalDate(localDate, timezone);
      const dayRules = rules.filter((rule) => rule.day_of_week === dayOfWeek && rule.active);

      for (const rule of dayRules) {
        matchingRuleIds.add(rule.id);
        const ruleTimezone = rule.timezone || timezone;
        let cursor = fromZonedTime(`${localDate}T${normalizeTime(rule.start_time)}`, ruleTimezone);
        const ruleEnd = fromZonedTime(`${localDate}T${normalizeTime(rule.end_time)}`, ruleTimezone);

        while (isBefore(addMinutes(cursor, service.duration_minutes), ruleEnd) || isEqual(addMinutes(cursor, service.duration_minutes), ruleEnd)) {
          const slotEnd = addMinutes(cursor, service.duration_minutes);
          const candidate = {
            startsAt: cursor.toISOString(),
            endsAt: slotEnd.toISOString(),
            timezone: ruleTimezone
          };
          const reasons: string[] = [];
          if ((isBefore(cursor, from) && !isEqual(cursor, from)) || (isBefore(to, slotEnd) && !isEqual(to, slotEnd))) {
            reasons.push('outside_range');
          }
          if (!isBefore(new Date(), cursor)) {
            reasons.push('past');
          }

          const buffered = {
            start: addMinutes(cursor, -service.buffer_before_minutes),
            end: addMinutes(slotEnd, service.buffer_after_minutes)
          };
          const blockedBy = occupied.filter((range) => overlaps(buffered, range)).map((range) => range.source);
          if (blockedBy.length > 0) {
            reasons.push('occupied');
          }

          const diagnostic = {
            ...candidate,
            localDate,
            dayOfWeek,
            ruleId: rule.id,
            available: reasons.length === 0,
            reasons,
            blockedBy: [...new Set(blockedBy)]
          };

          if (diagnostic.available) {
            slots.push(candidate);
          }
          if (includeDiagnostics) {
            candidates.push(diagnostic);
          }
          cursor = addMinutes(cursor, service.duration_minutes);
        }
      }
    }

    const dedupedSlots = dedupeSlots(slots);
    const details = includeDiagnostics
      ? {
          service: {
            id: service.id,
            name: service.name,
            duration_minutes: service.duration_minutes,
            buffer_before_minutes: service.buffer_before_minutes,
            buffer_after_minutes: service.buffer_after_minutes,
            active: service.active
          },
          range: {
            from: from.toISOString(),
            to: to.toISOString(),
            timezone,
            localDates
          },
          counts: {
            activeRules: rules.filter((rule) => rule.active).length,
            matchingRules: matchingRuleIds.size,
            blackouts: blackouts.length,
            preReservations: holds.length,
            googleBusy: googleBusy.length,
            candidates: candidates.length,
            available: dedupedSlots.length
          },
          candidates,
          slots: dedupedSlots
        }
      : undefined;

    return { slots: dedupedSlots, details };
  }
}

function normalizeTime(value: string): string {
  return value.length === 5 ? `${value}:00` : value;
}

function dayOfWeekForLocalDate(localDate: string, timezone: string): number {
  const date = fromZonedTime(`${localDate}T12:00:00`, timezone);
  return Number(formatInTimeZone(date, timezone, 'i')) % 7;
}

function localDatesInRange(from: Date, to: Date, timezone: string): string[] {
  const dates: string[] = [];
  let cursor = fromZonedTime(`${formatInTimeZone(from, timezone, 'yyyy-MM-dd')}T12:00:00`, timezone);
  const end = fromZonedTime(`${formatInTimeZone(to, timezone, 'yyyy-MM-dd')}T12:00:00`, timezone);

  while (isBefore(cursor, end) || isEqual(cursor, end)) {
    const localDate = formatInTimeZone(cursor, timezone, 'yyyy-MM-dd');
    if (dates[dates.length - 1] !== localDate) {
      dates.push(localDate);
    }
    cursor = addDays(cursor, 1);
  }

  return dates;
}

function overlaps(left: TimeRange, right: TimeRange): boolean {
  return left.start < right.end && right.start < left.end;
}

function dedupeSlots(slots: AvailabilitySlot[]): AvailabilitySlot[] {
  const seen = new Set<string>();
  return slots
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
    .filter((slot) => {
      if (seen.has(slot.startsAt)) {
        return false;
      }
      seen.add(slot.startsAt);
      return true;
    });
}
