import dayjs from 'dayjs';
export const fmt = (ts) => (ts ? dayjs(ts?.toDate?.() ?? ts).format('DD/MM/YYYY') : '-');
export const isExpired = (ts) => dayjs(ts?.toDate?.() ?? ts).isBefore(dayjs(), 'day');
export const isNearExpire = (ts, days = 3) =>
  dayjs(ts?.toDate?.() ?? ts).isBefore(dayjs().add(days, 'day'), 'day');
