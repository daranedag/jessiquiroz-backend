# Contrato del Backend

Backend REST para agenda, pre-reservas, subida de imagenes, pagos con Mercado Pago y administracion.

## Base URL

Local:

```txt
http://localhost:3000
```

Produccion:

```txt
<BACKEND_URL>
```

Version de API:

```txt
<BACKEND_URL>/api/v1
```

Ejemplo:

```ts
const API_BASE_URL = "http://localhost:3000";
const API_V1 = `${API_BASE_URL}/api/v1`;
```

## Formato de Respuesta

Respuesta exitosa general:

```json
{
  "data": {}
}
```

Respuesta de error:

```json
{
  "error": {
    "code": "validation_error",
    "message": "Invalid request payload",
    "details": {}
  }
}
```

## Headers

### Token de reserva del cliente

Se recibe al crear una pre-reserva. Debe guardarse en el frontend para consultar, editar, subir imagenes, crear pago y consultar estado.

```http
X-Reservation-Token: <customerToken>
```

### API key admin

Solo para panel/admin.

```http
X-Admin-Api-Key: <ADMIN_API_KEY>
```

### Secret de job interno

No usar desde frontend publico.

```http
X-Internal-Job-Secret: <INTERNAL_JOB_SECRET>
```

## Tipos Base

### Service

```ts
type Service = {
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
```

### PreReservation

```ts
type PreReservationStatus =
  | "draft"
  | "awaiting_payment"
  | "paid_pending_calendar"
  | "confirmed"
  | "expired"
  | "cancelled"
  | "manual_review";

type PreReservation = {
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
  created_at: string;
  updated_at: string;
};
```

Nota: el backend no expone `customer_token_hash`.

### ReservationImage

```ts
type ReservationImage = {
  id: string;
  pre_reservation_id: string;
  imagekit_file_id: string;
  imagekit_path: string;
  url: string;
  mime_type: string;
  size_bytes: number;
  width: number | null;
  height: number | null;
  status: "active" | "deleted";
  created_at: string;
  updated_at: string;
};
```

### Payment

```ts
type PaymentStatus =
  | "created"
  | "pending"
  | "approved"
  | "rejected"
  | "cancelled"
  | "refunded";

type Payment = {
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
```

### Booking

```ts
type Booking = {
  id: string;
  pre_reservation_id: string;
  payment_id: string;
  service_id: string;
  starts_at: string;
  ends_at: string;
  timezone: string;
  status: "confirmed" | "rescheduled" | "cancelled";
  created_at: string;
  updated_at: string;
};
```

### CalendarEvent

```ts
type CalendarEvent = {
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
```

## Endpoints Publicos

### Health

```http
GET /health
```

Respuesta:

```json
{
  "ok": true
}
```

### Ready

```http
GET /ready
```

Respuesta:

```ts
{
  ok: boolean;
  details: {
    name: "database" | "googleCalendar" | "mercadoPago" | "imageKit";
    ok: boolean;
    reason?: string;
  }[];
}
```

### Listar servicios activos

```http
GET /api/v1/services
```

Respuesta:

```ts
{
  data: Service[];
}
```

### Consultar disponibilidad

```http
GET /api/v1/availability?serviceId=<uuid>&from=<iso>&to=<iso>&timezone=America/Santiago
```

Query params:

```ts
{
  serviceId: string;
  from: string;
  to: string;
  timezone?: string;
}
```

Respuesta:

```ts
{
  data: {
    startsAt: string;
    endsAt: string;
    timezone: string;
  }[];
}
```

Errores posibles:

```txt
400 inactive_service
400 invalid_range
404 not_found
```

### Crear pre-reserva

```http
POST /api/v1/pre-reservations
Content-Type: application/json
```

Body:

```ts
{
  serviceId: string;
  startsAt: string;
  timezone?: string;
  client: {
    fullName: string;
    email: string;
    phone?: string;
    notes?: string;
    formData?: Record<string, unknown>;
  };
}
```

Respuesta:

```ts
{
  data: {
    preReservation: PreReservation;
    customerToken: string;
  };
}
```

Importante: guardar `customerToken`; despues no se puede recuperar desde el backend.

Errores posibles:

```txt
404 not_found
409 slot_unavailable
```

### Obtener pre-reserva del cliente

```http
GET /api/v1/pre-reservations/:id
X-Reservation-Token: <customerToken>
```

Respuesta:

```ts
{
  data: {
    preReservation: PreReservation;
    images: ReservationImage[];
  };
}
```

Errores posibles:

```txt
401 missing_reservation_token
401 invalid_reservation_token
404 not_found
```

### Editar datos del cliente en una pre-reserva

```http
PATCH /api/v1/pre-reservations/:id
X-Reservation-Token: <customerToken>
Content-Type: application/json
```

Body:

```ts
{
  client?: {
    fullName?: string;
    email?: string;
    phone?: string | null;
    notes?: string | null;
    formData?: Record<string, unknown>;
  };
}
```

Respuesta:

```ts
{
  data: PreReservation;
}
```

Solo se puede editar si la pre-reserva esta en `draft` o `awaiting_payment`.

Errores posibles:

```txt
401 missing_reservation_token
401 invalid_reservation_token
409 pre_reservation_locked
```

### Subir imagenes a una pre-reserva

```http
POST /api/v1/pre-reservations/:id/images
X-Reservation-Token: <customerToken>
Content-Type: multipart/form-data
```

Form data:

```txt
images: File[]
```

Respuesta:

```ts
{
  data: ReservationImage[];
}
```

Limites por defecto:

```txt
max files: 6
max size per file: 8 MB
```

Errores posibles:

```txt
400 missing_files
400 too_many_files
401 missing_reservation_token
401 invalid_reservation_token
409 pre_reservation_locked
```

### Eliminar imagen de una pre-reserva

```http
DELETE /api/v1/pre-reservations/:id/images/:imageId
X-Reservation-Token: <customerToken>
```

Respuesta:

```txt
204 No Content
```

Solo se puede eliminar si la pre-reserva esta en `draft` o `awaiting_payment`.

### Crear preferencia de pago

```http
POST /api/v1/pre-reservations/:id/payment
X-Reservation-Token: <customerToken>
```

Respuesta:

```ts
{
  data: {
    paymentId: string;
    preferenceId: string;
    initPoint: string | null;
    sandboxInitPoint: string | null;
  };
}
```

El frontend debe redirigir a:

```ts
const checkoutUrl = data.initPoint ?? data.sandboxInitPoint;
```

Errores posibles:

```txt
401 missing_reservation_token
401 invalid_reservation_token
409 invalid_pre_reservation_status
```

### Consultar estado de pago

```http
GET /api/v1/pre-reservations/:id/payment-status
X-Reservation-Token: <customerToken>
```

Respuesta:

```ts
{
  data: {
    preReservationStatus: PreReservationStatus;
    paymentStatus: PaymentStatus | null;
    bookingId: string | null;
  };
}
```

Cuando `bookingId` tenga valor, se puede consultar la reserva confirmada.

### Obtener reserva confirmada

```http
GET /api/v1/bookings/:id
X-Reservation-Token: <customerToken>
```

Respuesta:

```ts
{
  data: {
    booking: Booking;
    preReservation: PreReservation;
    calendarEvent: CalendarEvent | null;
  };
}
```

## Endpoints Admin

Todos requieren:

```http
X-Admin-Api-Key: <ADMIN_API_KEY>
```

### Servicios

```http
GET /api/v1/admin/services
```

Respuesta:

```ts
{
  data: Service[];
}
```

```http
POST /api/v1/admin/services
Content-Type: application/json
```

Body:

```ts
{
  name: string;
  description?: string | null;
  duration_minutes: number;
  buffer_before_minutes?: number;
  buffer_after_minutes?: number;
  price_amount: number;
  currency?: string;
  active?: boolean;
}
```

Respuesta:

```ts
{
  data: Service;
}
```

```http
PATCH /api/v1/admin/services/:id
Content-Type: application/json
```

Body:

```ts
Partial<{
  name: string;
  description: string | null;
  duration_minutes: number;
  buffer_before_minutes: number;
  buffer_after_minutes: number;
  price_amount: number;
  currency: string;
  active: boolean;
}>
```

Respuesta:

```ts
{
  data: Service;
}
```

```http
DELETE /api/v1/admin/services/:id
```

Respuesta:

```txt
204 No Content
```

### Reglas de disponibilidad

```ts
type AvailabilityRule = {
  id: string;
  day_of_week: number;
  start_time: string;
  end_time: string;
  timezone: string;
  active: boolean;
  created_at: string;
  updated_at: string;
};
```

```http
GET /api/v1/admin/availability-rules
```

Respuesta:

```ts
{
  data: AvailabilityRule[];
}
```

```http
POST /api/v1/admin/availability-rules
Content-Type: application/json
```

Body:

```ts
{
  day_of_week: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  start_time: string;
  end_time: string;
  timezone?: string;
  active?: boolean;
}
```

Notas:

- `day_of_week`: `0` domingo, `1` lunes, ..., `6` sabado.
- `start_time` y `end_time`: formato `HH:mm` o `HH:mm:ss`.

Respuesta:

```ts
{
  data: AvailabilityRule;
}
```

```http
PATCH /api/v1/admin/availability-rules/:id
```

Body:

```ts
Partial<{
  day_of_week: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  start_time: string;
  end_time: string;
  timezone: string;
  active: boolean;
}>
```

Respuesta:

```ts
{
  data: AvailabilityRule;
}
```

```http
DELETE /api/v1/admin/availability-rules/:id
```

Respuesta:

```txt
204 No Content
```

### Fechas bloqueadas

```ts
type BlackoutDate = {
  id: string;
  starts_at: string;
  ends_at: string;
  reason: string | null;
  created_at: string;
  updated_at: string;
};
```

```http
GET /api/v1/admin/blackout-dates
```

Respuesta:

```ts
{
  data: BlackoutDate[];
}
```

```http
POST /api/v1/admin/blackout-dates
Content-Type: application/json
```

Body:

```ts
{
  starts_at: string;
  ends_at: string;
  reason?: string | null;
}
```

Respuesta:

```ts
{
  data: BlackoutDate;
}
```

```http
PATCH /api/v1/admin/blackout-dates/:id
```

Body:

```ts
Partial<{
  starts_at: string;
  ends_at: string;
  reason: string | null;
}>
```

Respuesta:

```ts
{
  data: BlackoutDate;
}
```

```http
DELETE /api/v1/admin/blackout-dates/:id
```

Respuesta:

```txt
204 No Content
```

### Pre-reservas admin

```http
GET /api/v1/admin/pre-reservations
```

Respuesta:

```ts
{
  data: PreReservation[];
}
```

```http
GET /api/v1/admin/pre-reservations/:id
```

Respuesta:

```ts
{
  data: {
    preReservation: PreReservation;
    images: (ReservationImage & {
      signedUrl: string;
    })[];
  };
}
```

```http
PATCH /api/v1/admin/pre-reservations/:id/status
Content-Type: application/json
```

Body:

```ts
{
  status: "cancelled" | "manual_review" | "expired";
}
```

Respuesta:

```ts
{
  data: PreReservation;
}
```

### Reservas admin

```http
GET /api/v1/admin/bookings
```

Respuesta:

```ts
{
  data: Booking[];
}
```

```http
PATCH /api/v1/admin/bookings/:id/reschedule
Content-Type: application/json
```

Body:

```ts
{
  startsAt: string;
  timezone?: string;
}
```

Respuesta:

```ts
{
  data: Booking;
}
```

```http
PATCH /api/v1/admin/bookings/:id/cancel
```

Respuesta:

```ts
{
  data: Booking;
}
```

```http
POST /api/v1/admin/bookings/:id/calendar/resync
```

Respuesta:

```ts
{
  data: CalendarEvent;
}
```

### Pagos admin

```http
GET /api/v1/admin/payments
```

Respuesta:

```ts
{
  data: Payment[];
}
```

### Auditoria admin

```ts
type AuditLog = {
  id: string;
  actor: string;
  action: string;
  entity_type: string;
  entity_id: string;
  metadata: Record<string, unknown>;
  created_at: string;
};
```

```http
GET /api/v1/admin/audit-logs
```

Respuesta:

```ts
{
  data: AuditLog[];
}
```

## Webhooks e Internos

Estos endpoints no deberian consumirse desde el frontend publico.

### Webhook Mercado Pago

```http
POST /api/v1/webhooks/mercadopago
```

Body aceptado:

```ts
{
  id?: string | number;
  type?: string;
  action?: string;
  data?: {
    id?: string | number;
  };
}
```

Respuesta:

```ts
{
  ok: true;
  processed: boolean;
}
```

### Expirar pre-reservas

```http
POST /api/v1/internal/jobs/expire-pre-reservations
X-Internal-Job-Secret: <INTERNAL_JOB_SECRET>
```

Respuesta:

```ts
{
  data: {
    expired: number;
  };
}
```

## Flujo Recomendado para Frontend

1. `GET /api/v1/services`
2. `GET /api/v1/availability`
3. `POST /api/v1/pre-reservations`
4. Guardar `preReservation.id` y `customerToken`.
5. Opcional: `POST /api/v1/pre-reservations/:id/images`
6. `POST /api/v1/pre-reservations/:id/payment`
7. Redirigir al usuario a `initPoint` o `sandboxInitPoint`.
8. Al volver desde Mercado Pago, consultar `GET /api/v1/pre-reservations/:id/payment-status`.
9. Si existe `bookingId`, consultar `GET /api/v1/bookings/:bookingId`.

## Codigos de Error Frecuentes

```txt
400 validation_error
400 inactive_service
400 invalid_range
400 missing_files
400 too_many_files
401 unauthorized
401 missing_reservation_token
401 invalid_reservation_token
404 not_found
409 slot_unavailable
409 pre_reservation_locked
409 invalid_pre_reservation_status
500 internal_error
502 insforge_error
503 insforge_not_configured
```
