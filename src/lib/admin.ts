/**
 * Аккаунты с доступом к внутренним админ-разделам (код регистрации,
 * статус пробных периодов балансеров). Общий список — используется и в
 * /code, и в профиле, и в кроне, генерирующем системные уведомления.
 */
export const ADMIN_EMAILS = ['2000gva@gmail.com', 'timewolf567@gmail.com'];

export function isAdminEmail(email: string | null | undefined): boolean {
  return !!email && ADMIN_EMAILS.includes(email);
}
