import http from "node:http";

const server = http.createServer((_request, response) => {
  response.writeHead(200, { "content-type": "text/plain" });
  response.end("Portboard fixture");
});

server.listen(Number(process.env.TEST_PORT ?? 0), "127.0.0.1", () => {
  const address = server.address();
  if (address && typeof address === "object") {
    process.stdout.write(`READY:${address.port}\n`);
  }
});
