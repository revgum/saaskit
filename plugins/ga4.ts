// Copyright 2023 the Deno authors. All rights reserved. MIT license.
import type { MiddlewareHandlerContext, Plugin } from "$fresh/server.ts";
import type { Event } from "$ga4";
import { GA4Report, isDocument, isServerError } from "$ga4";
import type { State } from "@/middleware/session.ts";

let showedMissingEnvWarning = false;

function ga4(
  request: Request,
  conn: MiddlewareHandlerContext,
  response: Response,
  _start: number,
  error?: unknown,
) {
  const GA4_MEASUREMENT_ID = Deno.env.get("GA4_MEASUREMENT_ID");

  if (GA4_MEASUREMENT_ID === undefined) {
    if (!showedMissingEnvWarning) {
      showedMissingEnvWarning = true;
      console.warn(
        "GA4_MEASUREMENT_ID environment variable not set. Google Analytics reporting disabled.",
      );
    }
    return;
  }
  Promise.resolve().then(async () => {
    // We're tracking page views and file downloads. These are the only two
    // HTTP methods that _might_ be used.
    if (!/^(GET|POST)$/.test(request.method)) {
      return;
    }

    // If the visitor is using a web browser, only create events when we serve
    // a top level documents or download; skip assets like css, images, fonts.
    if (!isDocument(request, response) && error == null) {
      return;
    }

    let event: Event | null = null;
    const contentType = response.headers.get("content-type");
    if (/text\/html/.test(contentType!)) {
      event = { name: "page_view", params: {} }; // Probably an old browser.
    }

    if (event == null && error == null) {
      return;
    }

    // If an exception was thrown, build a separate event to report it.
    let exceptionEvent;
    if (error != null) {
      exceptionEvent = {
        name: "exception",
        params: {
          description: String(error),
          fatal: isServerError(response),
        },
      };
    } else {
      exceptionEvent = undefined;
    }

    // Create basic report.
    const measurementId = GA4_MEASUREMENT_ID;
    // @ts-ignore GA4Report doesn't even use the localAddress parameter
    const report = new GA4Report({ measurementId, request, response, conn });

    // Override the default (page_view) event.
    report.event = event;

    // Add the exception event, if any.
    if (exceptionEvent != null) {
      report.events.push(exceptionEvent);
    }

    await report.send();
  }).catch((err) => {
    console.error(`Internal error: ${err}`);
  });
}

export default {
  name: "ga4",
  middlewares: [
    {
      path: "/",
      middleware: {
        async handler(req, ctx) {
          let err;
          let res: Response;
          const start = performance.now();
          try {
            const resp = await ctx.next();
            const headers = new Headers(resp.headers);
            res = new Response(resp.body, { status: resp.status, headers });
            return res;
          } catch (e) {
            res = new Response("Internal Server Error", {
              status: 500,
            });
            err = e;
            throw e;
          } finally {
            ga4(
              req,
              ctx as MiddlewareHandlerContext,
              res!,
              start,
              err,
            );
          }
        },
      },
    },
  ],
} as Plugin<State>;