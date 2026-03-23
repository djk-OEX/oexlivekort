export default async function (context, req) {
  try {
    const url =
      "http://midttrafik.admin.gc2.io/ows/midttrafik/rute_wfs?" +
      "SERVICE=WFS&" +
      "VERSION=1.1.0&" +
      "REQUEST=GetFeature&" +
      "TYPENAME=rute_wfs.stoppesteder_midttrafik&" +
      "OUTPUTFORMAT=application/json";

    const resp = await fetch(url, {
      headers: { accept: "application/json" }
    });

    if (!resp.ok) {
      context.res = {
        status: resp.status,
        body: await resp.text()
      };
      return;
    }

    const body = await resp.text();

    context.res = {
      status: 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "public, max-age=60"
      },
      body
    };
  } catch (err) {
    context.res = {
      status: 500,
      body: "Proxy error: " + err.message
    };
  }
}
