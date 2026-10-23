const { z } = require('zod');
const { bad } = require('./errors');

const tz = z.string().max(64).refine(v => { try { new Intl.DateTimeFormat('en', { timeZone: v }); return true; } catch { return false; } }, 'Unknown timezone');
const text = (max) => z.string().trim().max(max);
const num = z.coerce.number().finite().min(0).max(100000);
const mealType = z.enum(['breakfast', 'lunch', 'dinner', 'snack']);
const item = z.object({ name: text(60).min(1), portion_g: num, portion_text: text(40).optional().default(''), kcal: num, protein: num, carbs: num, fat: num });

const schemas = {
  register: z.object({
    name: text(60).min(1, 'Please enter your name'),
    email: z.string().trim().toLowerCase().email('Please enter a valid email').max(120),
    password: z.string().min(8, 'Password must be at least 8 characters').max(72),
    role: z.enum(['coach', 'client']),
    inviteCode: z.string().trim().toUpperCase().max(20).optional(),
    timezone: tz.optional(),
  }),
  login: z.object({ email: z.string().trim().toLowerCase().max(120), password: z.string().min(1).max(72) }),
  profile: z.object({ name: text(60).min(1).optional(), goalKcal: z.coerce.number().int().min(800).max(6000).optional(), timezone: tz.optional() }).strict(),
  password: z.object({ current: z.string().min(1).max(72), next: z.string().min(8, 'Password must be at least 8 characters').max(72) }),
  linkCoach: z.object({ inviteCode: z.string().trim().toUpperCase().min(4).max(20) }),
  deleteAccount: z.object({ password: z.string().min(1).max(72) }),
  logMeal: z.object({ image: z.string().max(3_000_000), note: text(300).optional().default(''), mealType: mealType.optional().nullable() }),
  editMeal: z.object({ name: text(60).min(1).optional(), mealType: mealType.optional().nullable(), items: z.array(item).min(1).max(20).optional() }),
  reply: z.object({ body: text(500).min(1, 'Write a reply first') }),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date').refine(s => !isNaN(Date.parse(s + 'T00:00:00Z')), 'Invalid date'),
  uuid: z.string().uuid('Invalid id'),
};

function parse(schema, data) {
  const r = schema.safeParse(data ?? {});
  if (!r.success) {
    const issue = r.error.issues[0];
    const field = issue.path.join('.');
    const generic = /^(Invalid input|Required|Invalid option|Expected)/.test(issue.message);
    throw bad(generic ? `Please check "${field || 'your request'}".` : issue.message, { field });
  }
  return r.data;
}
module.exports = { schemas, parse };
