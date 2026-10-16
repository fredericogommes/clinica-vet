const dateTime = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

export const formatDateTime = (iso: string): string => dateTime.format(new Date(iso));

const day = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
export const formatDay = (iso: string): string => day.format(new Date(iso));
