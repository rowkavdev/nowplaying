// Adapt existing JSON-shaped fixtures to real streamed response bytes.
export function streamJsonFixture(response) {
  return { ...response, body: new ReadableStream({ async start(controller) {
    try { controller.enqueue(new TextEncoder().encode(JSON.stringify(await response.json()))); controller.close(); }
    catch (error) { controller.error(error); }
  } }) };
}
