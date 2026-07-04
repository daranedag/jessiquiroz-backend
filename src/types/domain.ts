export type Service = {
  id: string;
  name: string;
  description: string | null;
  duration_minutes: number;
  buffer_before_minutes: number;
  buffer_after_minutes: number;
  price_amount: number;
  currency: string;
  active: boolean;
  created_at: string;
  updated_at: string;
};

export type AvailabilityRule = {
  id: string;
  day_of_week: number;
  start_time: string;
  end_time: string;
  timezone: string;
  active: boolean;
  created_at: string;
  updated_at: string;
};

export type BlackoutDate = {
  id: string;
  starts_at: string;
  ends_at: string;
  reason: string | null;
  created_at: string;
  updated_at: string;
};

export type PreReservationStatus =
  | 'draft'
  | 'awaiting_payment'
  | 'paid_pending_calendar'
  | 'confirmed'
  | 'expired'
  | 'cancelled'
  | 'manual_review';

export type PaymentStatus = 'created' | 'pending' | 'approved' | 'rejected' | 'cancelled' | 'refunded';

export type BookingStatus = 'confirmed' | 'rescheduled' | 'cancelled';

export type ClientInfo = {
  fullName: string;
  email: string;
  phone?: string;
  notes?: string;
  formData?: Record<string, unknown>;
};

export type PreReservation = {
  id: string;
  service_id: string;
  client_name: string;
  client_email: string;
  client_phone: string | null;
  client_notes: string | null;
  form_data: Record<string, unknown>;
  starts_at: string;
  ends_at: string;
  timezone: string;
  status: PreReservationStatus;
  expires_at: string;
  customer_token_hash: string;
  created_at: string;
  updated_at: string;
};

export type ReservationImage = {
  id: string;
  pre_reservation_id: string;
  imagekit_file_id: string;
  imagekit_path: string;
  url: string;
  mime_type: string;
  size_bytes: number;
  width: number | null;
  height: number | null;
  status: 'active' | 'deleted';
  created_at: string;
  updated_at: string;
};

export type Payment = {
  id: string;
  pre_reservation_id: string;
  mercado_pago_preference_id: string | null;
  mercado_pago_payment_id: string | null;
  status: PaymentStatus;
  amount: number;
  currency: string;
  init_point: string | null;
  sandbox_init_point: string | null;
  raw_payload: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type Booking = {
  id: string;
  pre_reservation_id: string;
  payment_id: string;
  service_id: string;
  starts_at: string;
  ends_at: string;
  timezone: string;
  status: BookingStatus;
  created_at: string;
  updated_at: string;
};

export type CalendarEvent = {
  id: string;
  booking_id: string;
  google_event_id: string;
  calendar_id: string;
  html_link: string | null;
  meet_link: string | null;
  raw_payload: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type WebhookEvent = {
  id: string;
  provider: 'mercadopago';
  event_key: string;
  processed_at: string | null;
  raw_payload: Record<string, unknown>;
  created_at: string;
};

export type AuditLog = {
  id: string;
  actor: string;
  action: string;
  entity_type: string;
  entity_id: string;
  metadata: Record<string, unknown>;
  created_at: string;
};

export type TimeRange = {
  start: Date;
  end: Date;
};
