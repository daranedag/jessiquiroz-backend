import { addMinutes, eachDayOfInterval, isBefore, isEqual } from 'date-fns';
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

export class AvailabilityService {
  constructor(
    private readonly repository: BookingRepository,
    private readonly googleCalendar: GoogleCalendarClient
  ) {}

  async listSlots(serviceId: string, fromIso: string, toIso: string, timezone = env.GOOGLE_TIMEZONE): Promise<AvailabilitySlot[]> {
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

    const occupied: TimeRange[] = [
      ...blackouts.map((blackout) => ({ start: new Date(blackout.starts_at), end: new Date(blackout.ends_at) })),
      ...holds.map((hold) => ({ start: new Date(hold.starts_at), end: new Date(hold.ends_at) })),
      ...googleBusy
    ];

    const slots: AvailabilitySlot[] = [];
    const days = eachDayOfInterval({ start: from, end: to });
    for (const day of days) {
      const localDate = formatInTimeZone(day, timezone, 'yyyy-MM-dd');
      const dayOfWeek = dayOfWeekForLocalDate(localDate, timezone);
      const dayRules = rules.filter((rule) => rule.day_of_week === dayOfWeek && rule.active);

      for (const rule of dayRules) {
        const ruleTimezone = rule.timezone || timezone;
        let cursor = fromZonedTime(`${localDate}T${normalizeTime(rule.start_time)}`, ruleTimezone);
        const ruleEnd = fromZonedTime(`${localDate}T${normalizeTime(rule.end_time)}`, ruleTimezone);

        while (isBefore(addMinutes(cursor, service.duration_minutes), ruleEnd) || isEqual(addMinutes(cursor, service.duration_minutes), ruleEnd)) {
          const slotEnd = addMinutes(cursor, service.duration_minutes);
          if ((isBefore(from, cursor) || isEqual(from, cursor)) && (isBefore(slotEnd, to) || isEqual(slotEnd, to))) {
            const buffered = {
              start: addMinutes(cursor, -service.buffer_before_minutes),
              end: addMinutes(slotEnd, service.buffer_after_minutes)
            };
            if (isBefore(new Date(), cursor) && !occupied.some((range) => overlaps(buffered, range))) {
              slots.push({
                startsAt: cursor.toISOString(),
                endsAt: slotEnd.toISOString(),
                timezone: ruleTimezone
              });
            }
          }
          cursor = addMinutes(cursor, service.duration_minutes);
        }
      }
    }

    return dedupeSlots(slots);
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
}

function normalizeTime(value: string): string {
  return value.length === 5 ? `${value}:00` : value;
}

function dayOfWeekForLocalDate(localDate: string, timezone: string): number {
  const date = fromZonedTime(`${localDate}T12:00:00`, timezone);
  return Number(formatInTimeZone(date, timezone, 'i')) % 7;
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
