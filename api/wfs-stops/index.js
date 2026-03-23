export default async function (context, req) {
  try {
    const url = "https://midttrafik.admin.gc2.io/ows/midttrafik/rute_wfs/?service=WFS&version=1.0.0&request=GetFeature&typeName=midttrafik:stoppesteder&outputFormat=application/json";
    const resp = await fetch(url, { headers: { "accept": "application/json" } });
    if (!resp.ok) {
      context.res = { status: resp.status, body: await resp.text() };
      return;
    }
    const json = await resp.text(); // passthrough
    context.res = {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "public, max-age=900"
      },
      body: json
    };
  } catch (err) {
    context.log.error(err);
    context.res = { status: 500, body: "Proxy error: " + err.message };
  }
}
