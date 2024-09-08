const express = require("express");
const cors = require("cors");
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const app = express();
const port = 3001;
const WebSocket = require("ws");

app.use(express.json());
app.use(
  cors({
    origin: "http://localhost:3000",
    methods: ["GET", "POST"],
  })
);

const wss = new WebSocket.Server({ port: 8080 });

let currentK6Process = null;

app.post("/run-test", (req, res) => {
  const {
    users,
    duration,
    urls,
    jsonFile,
    loadProfile,
    rampUpDuration,
    httpMethod,
    headers,
  } = req.body;

  let optionsContent;

  switch (loadProfile) {
    case "ramp-up":
      optionsContent = `
    stages: [
      { duration: '${rampUpDuration}s', target: ${users} },
      { duration: '${duration - rampUpDuration}s', target: ${users} },
    ],
    `;
      break;
    case "constant":
    default:
      optionsContent = `
    vus: ${users},
    duration: '${duration}s',
    `;
      break;
  }

  let headersContent = "";
  if (headers && Object.keys(headers).length > 0) {
    headersContent = `
  const headers = ${JSON.stringify(headers)};
    `;
  }

  let requestContent;
  if (httpMethod === "GET") {
    requestContent = `
      let res = http.get(url, { headers: headers });
    `;
  } else if (httpMethod === "POST") {
    requestContent = `
      let payload = {};  // You might want to populate this based on your needs
      let res = http.post(url, JSON.stringify(payload), { headers: headers });
    `;
  }

  const scriptContent = `
  import http from 'k6/http';
  import { check, sleep } from 'k6';

  ${headersContent}

  export const options = {
    ${optionsContent}
    thresholds: {
      http_req_duration: ['p(95)<500'],
    },
  };

  export default function () {
    ${urls
      .map(
        (url) => `
    const url = '${url}';
    ${requestContent}
    check(res, { 'status is 200': (r) => r.status === 200 });
    sleep(1);  // Add a 1 second sleep between iterations
    `
      )
      .join("")}
  };
`;

  const scriptPath = path.join(__dirname, "k6-script.js");
  fs.writeFileSync(scriptPath, scriptContent);

  if (currentK6Process) {
    currentK6Process.kill();
  }

  currentK6Process = spawn("k6", [
    "run",
    "--summary-export=summary.json",
    scriptPath,
  ]);

  let outputBuffer = "";

  const sendBufferedOutput = () => {
    if (outputBuffer.trim()) {
      wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify({ type: "output", data: outputBuffer }));
        }
      });
      outputBuffer = "";
    }
  };

  currentK6Process.stdout.on("data", (data) => {
    outputBuffer += data.toString();
    if (outputBuffer.includes("\n")) {
      sendBufferedOutput();
    }
  });

  currentK6Process.stderr.on("data", (data) => {
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify({ type: "error", data: data.toString() }));
      }
    });
  });

  currentK6Process.on("close", (code) => {
    sendBufferedOutput(); // Send any remaining buffered output
    currentK6Process = null; // Reset the currentK6Process when it's done
    fs.readFile("summary.json", "utf8", (err, data) => {
      if (err) {
        console.error("Error reading summary file:", err);
        return;
      }
      wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(
            JSON.stringify({ type: "summary", data: JSON.parse(data) })
          );
        }
      });
    });
    res.send({ message: "Test completed" });
  });
});

app.post("/cancel-test", (req, res) => {
  if (currentK6Process) {
    currentK6Process.kill();
    currentK6Process = null;
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(
          JSON.stringify({ type: "cancelled", data: "Test cancelled by user" })
        );
      }
    });
    res.send({ message: "Test cancelled" });
  } else {
    res.status(400).send({ error: "No test is currently running" });
  }
});

app.listen(port, () => {
  console.log(`Backend server listening at http://localhost:${port}`);
});
