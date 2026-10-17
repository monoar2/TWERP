import { z } from "zod";
import { badRequest } from "./errors.js";

export function parse<T extends z.ZodType>(schema: T, value: unknown): z.infer<T> {
  const r = schema.safeParse(value);
  if (!r.success) throw badRequest("Datos inválidos", z.flattenError(r.error));
  return r.data;
}

export const num = z.union([z.number(), z.string().regex(/^-?\d+(\.\d+)?$/)]);
export const id = z.coerce.number().int().positive();
export const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const period = z.object({ year: z.coerce.number().int().min(2000).max(2100), month: z.coerce.number().int().min(1).max(12) });
export const idParam = z.object({ id });
