export default async function (context, req) {
  try {
    const url =
      "http://midttrafik.admin.gc2.io/ows/midttrafik/rute_wfs/?" +
      "service=WFS&" +
      "version=1.0.0&" +
      "request=GetFeature&" +
      "typeName=midttrafik:stoppesteder&" +
      "outputFormat=application/json";

    const resp = await fetch(url, { headers: { accept: "application/json" } });

    if (!resp.ok) {
      context.res = {
        status: resp.status,
        body: await resp.text()
      };
      return;
    }

    const text = await resp.text();

    context.res = {
      status: 200,
      headers: {
        "content-type": "application/json",
        "cache-control": "public, max-age=60"
      },
      body: text
    };
  } catch (err) {
    context.res = { status: 500, body: "Proxy error: " + err.message };
  }
}
