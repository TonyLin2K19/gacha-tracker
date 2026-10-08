export async function api<T = unknown>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const res = await fetch('/api' + path, {
    method,
    headers: method === 'GET' ? {} : { 'Content-Type': 'application/json', 'X-Gacha-Request': '1' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || '操作失敗');
  return data as T;
}
export async function uploadGameIcon(gameId: string, file: File): Promise<{ icon: string }> {
  const res = await fetch('/api/games/' + encodeURIComponent(gameId) + '/icon', {
    method: 'PUT',
    headers: { 'Content-Type': file.type, 'X-Gacha-Request': '1' },
    body: file,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || '圖示上傳失敗');
  return data;
}
export const localTime = (iso = new Date().toISOString()) => {
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};
export function download(name: string, text: string, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
