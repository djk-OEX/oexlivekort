export default async function (context, req) {
  context.res = {
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify({ ok: true, ts: new Date().toISOString() })
  };
}
