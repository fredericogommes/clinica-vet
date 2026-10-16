import {
  agendaQuerySchema,
  agendaSchema,
  appointmentListSchema,
  appointmentSchema,
  changeStatusSchema,
  confirmShiftsResultSchema,
  createAppointmentSchema,
  openingHoursInputSchema,
  scheduleConfigSchema,
  scheduleMemberInputSchema,
  shiftInputSchema,
  shiftMonthQuerySchema,
  shiftSchema,
  slotQuerySchema,
  slotSchema,
  updateAppointmentSchema,
} from '@clinica/contracts';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { requireAuth } from '../../http/access-guard.js';
import type { AppointmentService } from './appointment-service.js';
import type { ScheduleConfigService } from './config-service.js';

const idParams = z.object({ id: z.uuid() });
const userParams = z.object({ userId: z.uuid() });

/** Configuração da agenda da unidade atual: funcionamento, profissionais e escala. */
export const scheduleRoutes: FastifyPluginAsyncZod<{
  config: ScheduleConfigService;
  appointments: AppointmentService;
}> = async (app, { config, appointments }) => {
  app.get(
    '/config',
    {
      config: { access: { kind: 'permission', permission: 'schedule.view' } },
      schema: { response: { 200: scheduleConfigSchema } },
    },
    async (request) => config.getConfig(requireAuth(request)),
  );

  app.put(
    '/opening-hours',
    {
      config: { access: { kind: 'permission', permission: 'schedule.configure' } },
      schema: { body: openingHoursInputSchema, response: { 200: scheduleConfigSchema } },
    },
    async (request) => config.setOpeningHours(requireAuth(request), request.body),
  );

  app.put(
    '/members/:userId',
    {
      config: { access: { kind: 'permission', permission: 'schedule.configure' } },
      schema: {
        params: userParams,
        body: scheduleMemberInputSchema,
        response: { 200: scheduleConfigSchema },
      },
    },
    async (request) => config.saveMember(requireAuth(request), request.params.userId, request.body),
  );

  app.delete(
    '/members/:userId',
    {
      config: { access: { kind: 'permission', permission: 'schedule.configure' } },
      schema: { params: userParams, response: { 200: scheduleConfigSchema } },
    },
    async (request) => config.removeMember(requireAuth(request), request.params.userId),
  );

  app.get(
    '/shifts',
    {
      config: { access: { kind: 'permission', permission: 'schedule.view' } },
      schema: { querystring: shiftMonthQuerySchema, response: { 200: z.array(shiftSchema) } },
    },
    async (request) => config.listShifts(requireAuth(request), request.query.month),
  );

  app.post(
    '/shifts',
    {
      config: { access: { kind: 'permission', permission: 'schedule.configure' } },
      schema: { body: shiftInputSchema, response: { 201: shiftSchema } },
    },
    async (request, reply) => {
      const shift = await config.createShift(requireAuth(request), request.body);
      return reply.status(201).send(shift);
    },
  );

  app.delete(
    '/shifts/:id',
    {
      config: { access: { kind: 'permission', permission: 'schedule.configure' } },
      schema: { params: idParams },
    },
    async (request, reply) => {
      await config.deleteShift(requireAuth(request), request.params.id);
      return reply.status(204).send();
    },
  );

  app.post(
    '/shifts/confirm',
    {
      config: { access: { kind: 'permission', permission: 'schedule.configure' } },
      schema: { body: shiftMonthQuerySchema, response: { 200: confirmShiftsResultSchema } },
    },
    async (request) => ({
      confirmed: await config.confirmMonth(requireAuth(request), request.body.month),
    }),
  );

  app.get(
    '/agenda',
    {
      config: { access: { kind: 'permission', permission: 'schedule.view' } },
      schema: { querystring: agendaQuerySchema, response: { 200: agendaSchema } },
    },
    async (request) => appointments.agenda(requireAuth(request), request.query),
  );

  app.get(
    '/slots',
    {
      config: { access: { kind: 'permission', permission: 'schedule.view' } },
      schema: { querystring: slotQuerySchema, response: { 200: z.array(slotSchema) } },
    },
    async (request) => appointments.slots(requireAuth(request), request.query),
  );
};

export const appointmentRoutes: FastifyPluginAsyncZod<{
  appointments: AppointmentService;
}> = async (app, { appointments }) => {
  app.post(
    '/',
    {
      config: { access: { kind: 'permission', permission: 'schedule.manage' } },
      schema: { body: createAppointmentSchema, response: { 201: appointmentListSchema } },
    },
    async (request, reply) => {
      const items = await appointments.create(requireAuth(request), request.body);
      return reply.status(201).send({ items });
    },
  );

  app.get(
    '/:id',
    {
      config: { access: { kind: 'permission', permission: 'schedule.view' } },
      schema: { params: idParams, response: { 200: appointmentSchema } },
    },
    async (request) => appointments.get(requireAuth(request), request.params.id),
  );

  app.put(
    '/:id',
    {
      config: { access: { kind: 'permission', permission: 'schedule.manage' } },
      schema: {
        params: idParams,
        body: updateAppointmentSchema,
        response: { 200: appointmentSchema },
      },
    },
    async (request) => appointments.update(requireAuth(request), request.params.id, request.body),
  );

  app.post(
    '/:id/status',
    {
      config: { access: { kind: 'permission', permission: 'schedule.manage' } },
      schema: { params: idParams, body: changeStatusSchema, response: { 200: appointmentSchema } },
    },
    async (request) =>
      appointments.changeStatus(requireAuth(request), request.params.id, request.body),
  );
};
