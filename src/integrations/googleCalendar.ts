import { randomUUID } from 'node:crypto';
import { google } from 'googleapis';
import pRetry from 'p-retry';
import { env, requireEnv } from '../config/env.js';
import type { Service, PreReservation, TimeRange } from '../types/domain.js';

export type CreatedCalendarEvent = {
  googleEventId: string;
  htmlLink: string | null;
  meetLink: string | null;
  raw: Record<string, unknown>;
};

export class GoogleCalendarClient {
  private readonly calendar = google.calendar('v3');
  private readonly auth = new google.auth.OAuth2(
    env.GOOGLE_CLIENT_ID,
    env.GOOGLE_CLIENT_SECRET,
    'urn:ietf:wg:oauth:2.0:oob'
  );

  constructor() {
    if (env.GOOGLE_REFRESH_TOKEN) {
      this.auth.setCredentials({ refresh_token: env.GOOGLE_REFRESH_TOKEN });
    }
  }

  async healthCheck(): Promise<void> {
    if (!env.GOOGLE_REFRESH_TOKEN) {
      return;
    }
    await this.calendar.calendarList.get({
      auth: this.auth,
      calendarId: env.GOOGLE_CALENDAR_ID
    });
  }

  async freeBusy(timeMin: Date, timeMax: Date): Promise<TimeRange[]> {
    if (!env.GOOGLE_REFRESH_TOKEN) {
      return [];
    }

    const response = await pRetry(
      () =>
        this.calendar.freebusy.query({
          auth: this.auth,
          requestBody: {
            timeMin: timeMin.toISOString(),
            timeMax: timeMax.toISOString(),
            timeZone: env.GOOGLE_TIMEZONE,
            items: [{ id: env.GOOGLE_CALENDAR_ID }]
          }
        }),
      { retries: 2 }
    );

    const busy = response.data.calendars?.[env.GOOGLE_CALENDAR_ID]?.busy ?? [];
    return busy
      .filter((slot): slot is { start: string; end: string } => Boolean(slot.start && slot.end))
      .map((slot) => ({ start: new Date(slot.start), end: new Date(slot.end) }));
  }

  async createEvent(preReservation: PreReservation, service: Service): Promise<CreatedCalendarEvent> {
    requireEnv('GOOGLE_REFRESH_TOKEN');
    const conferenceData = env.GOOGLE_CREATE_MEET
      ? {
          createRequest: {
            requestId: randomUUID(),
            conferenceSolutionKey: { type: 'hangoutsMeet' }
          }
        }
      : undefined;

    const response = await pRetry(
      () =>
        this.calendar.events.insert({
          auth: this.auth,
          calendarId: env.GOOGLE_CALENDAR_ID,
          conferenceDataVersion: env.GOOGLE_CREATE_MEET ? 1 : 0,
          sendUpdates: 'all',
          requestBody: {
            summary: `${service.name} - ${preReservation.client_name}`,
            description: buildDescription(preReservation),
            start: {
              dateTime: preReservation.starts_at,
              timeZone: preReservation.timezone
            },
            end: {
              dateTime: preReservation.ends_at,
              timeZone: preReservation.timezone
            },
            attendees: [{ email: preReservation.client_email, displayName: preReservation.client_name }],
            guestsCanInviteOthers: false,
            guestsCanModify: false,
            guestsCanSeeOtherGuests: false,
            conferenceData,
            extendedProperties: {
              private: {
                preReservationId: preReservation.id,
                serviceId: service.id
              }
            }
          }
        }),
      { retries: 2 }
    );

    const event = response.data;
    return {
      googleEventId: event.id ?? '',
      htmlLink: event.htmlLink ?? null,
      meetLink: event.hangoutLink ?? null,
      raw: event as Record<string, unknown>
    };
  }

  async updateEvent(eventId: string, startsAt: string, endsAt: string, timezone: string): Promise<CreatedCalendarEvent> {
    const response = await pRetry(
      () =>
        this.calendar.events.patch({
          auth: this.auth,
          calendarId: env.GOOGLE_CALENDAR_ID,
          eventId,
          sendUpdates: 'all',
          requestBody: {
            start: { dateTime: startsAt, timeZone: timezone },
            end: { dateTime: endsAt, timeZone: timezone }
          }
        }),
      { retries: 2 }
    );

    const event = response.data;
    return {
      googleEventId: event.id ?? eventId,
      htmlLink: event.htmlLink ?? null,
      meetLink: event.hangoutLink ?? null,
      raw: event as Record<string, unknown>
    };
  }

  async deleteEvent(eventId: string): Promise<void> {
    await this.calendar.events.delete({
      auth: this.auth,
      calendarId: env.GOOGLE_CALENDAR_ID,
      eventId,
      sendUpdates: 'all'
    });
  }
}

function buildDescription(preReservation: PreReservation): string {
  const notes = preReservation.client_notes ? `<p>${escapeHtml(preReservation.client_notes)}</p>` : '';
  return [
    '<p>Reserva creada desde el backend de agenda.</p>',
    `<p><strong>Email:</strong> ${escapeHtml(preReservation.client_email)}</p>`,
    preReservation.client_phone ? `<p><strong>Telefono:</strong> ${escapeHtml(preReservation.client_phone)}</p>` : '',
    notes
  ].join('');
}

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}
