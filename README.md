# Agenda, Pagos e Imagenes Backend

Backend REST con Express, Google Calendar, Mercado Pago, ImageKit e InsForge.

## Reglas de comandos

Usar siempre `pnpm`. Para InsForge CLI:

```bash
pnpm dlx @insforge/cli login
pnpm dlx @insforge/cli link
pnpm dlx @insforge/cli db migrations up --all
```

No usar `npm` ni `npx`.

## Desarrollo

```bash
pnpm install
cp .env.example .env
pnpm dev
```

Scripts:

- `pnpm dev`: servidor local con recarga.
- `pnpm build`: compila TypeScript.
- `pnpm typecheck`: validacion de tipos.
- `pnpm test`: tests.
- `pnpm lint`: lint.

## Flujo principal

1. El frontend consulta servicios y disponibilidad.
2. El cliente crea una pre-reserva.
3. El cliente sube imagenes asociadas a la pre-reserva.
4. El backend crea una preferencia de Mercado Pago.
5. El webhook verifica el pago en Mercado Pago.
6. Si el pago esta aprobado, el backend confirma la reserva y crea el evento en Google Calendar.
