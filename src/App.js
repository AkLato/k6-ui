import React, { useState, useEffect, useRef, useCallback } from "react";
import { Alert, AlertDescription, AlertTitle } from "./components/ui/alert";
import { AlertCircle, CheckCircle, Play, X } from "lucide-react";

const loadProfiles = [
  { value: "constant", label: "Constant" },
  { value: "ramp-up", label: "Ramp Up" },
  { value: "step", label: "Step" },
];

const predefinedUsers = [1, 5, 20];
const predefinedDurations = [10, 30, 120]; // in seconds

function App() {
  const [loadProfile, setLoadProfile] = useState("constant");
  const [users, setUsers] = useState(1);
  const [duration, setDuration] = useState(5);
  const [rampUpDuration, setRampUpDuration] = useState(duration / 2);
  const [urls, setUrls] = useState([
    "https://jsonplaceholder.typicode.com/posts",
  ]);
  const [httpMethod, setHttpMethod] = useState("GET");
  const [jsonFile, setJsonFile] = useState(null);
  const [isRunning, setIsRunning] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [headers, setHeaders] = useState(`Content-Type: application/json
Authorization: test`);
  const [runInfo, setRunInfo] = useState([]);
  const [testStatus, setTestStatus] = useState("idle");
  const [testSummary, setTestSummary] = useState(null);
  const [wsConnected, setWsConnected] = useState(false);

  // Refs
  const runInfoRef = useRef(null);
  const wsRef = useRef(null);
  const reconnectTimeoutRef = useRef(null);

  // Function definitions using useCallback
  const addRunInfo = useCallback((info) => {
    setRunInfo((prevInfo) => {
      const newInfo = { time: new Date().toLocaleTimeString(), message: info };
      if (
        prevInfo.length > 0 &&
        prevInfo[prevInfo.length - 1].message === info
      ) {
        return prevInfo;
      }
      return [...prevInfo, newInfo];
    });
  }, []);

  const processTestSummary = useCallback((summaryData) => {
    try {
      const metrics = summaryData.metrics;
      if (!metrics) {
        throw new Error("Metrics data is missing from the summary");
      }

      const requestsMade = metrics.http_reqs ? metrics.http_reqs.count : "N/A";
      const avgResponseTime = metrics.http_req_duration
        ? metrics.http_req_duration.avg.toFixed(2)
        : "N/A";
      const failedResponses =
        metrics.http_reqs && metrics.http_req_failed
          ? (
              (metrics.http_req_failed.fails / metrics.http_reqs.count) *
              100
            ).toFixed(2)
          : "N/A";

      setTestSummary({
        requestsMade,
        avgResponseTime,
        failedResponses:
          failedResponses === "N/A" ? "N/A" : `${failedResponses}%`,
      });
    } catch (error) {
      console.error("Error processing test summary:", error);
      setTestSummary({
        requestsMade: "Error",
        avgResponseTime: "Error",
        failedResponses: "Error",
      });
    }
  }, []);

  const connectWebSocket = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      return;
    }

    wsRef.current = new WebSocket("ws://localhost:8080");

    wsRef.current.onopen = () => {
      console.log("WebSocket connected");
      setWsConnected(true);
    };

    wsRef.current.onclose = () => {
      console.log("WebSocket disconnected");
      setWsConnected(false);
      reconnectTimeoutRef.current = setTimeout(connectWebSocket, 3000);
    };

    wsRef.current.onerror = (error) => {
      console.error("WebSocket error:", error);
    };

    wsRef.current.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        switch (message.type) {
          case "output":
            message.data.split("\n").forEach((line) => {
              if (line.trim()) {
                addRunInfo(line.trim());
              }
            });
            break;
          case "error":
            addRunInfo(`Error: ${message.data}`);
            break;
          case "summary":
            addRunInfo("Test completed");
            setTestStatus("completed");
            setIsRunning(false);
            processTestSummary(message.data);
            break;
          case "cancelled":
            addRunInfo(message.data);
            setIsRunning(false);
            setTestStatus("cancelled");
            break;
          default:
            console.warn("Unknown message type:", message.type);
        }
      } catch (error) {
        console.error("Error processing WebSocket message:", error);
      }
    };
  }, [addRunInfo, processTestSummary]);

  // useEffect hooks
  useEffect(() => {
    connectWebSocket();

    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
    };
  }, [connectWebSocket]);

  useEffect(() => {
    if (runInfoRef.current) {
      runInfoRef.current.scrollTop = runInfoRef.current.scrollHeight;
    }
  }, [runInfo]);

  // Other functions
  const updateDurationAndRampUp = (newDuration) => {
    setDuration(newDuration);
    setRampUpDuration(Math.floor(newDuration / 2));
  };

  const handleDurationChange = (e) => {
    const newDuration = parseInt(e.target.value);
    updateDurationAndRampUp(newDuration);
  };

  const handleAddUrl = () => {
    setUrls([...urls, ""]);
  };

  const handleUrlChange = (index, value) => {
    const newUrls = [...urls];
    newUrls[index] = value;
    setUrls(newUrls);
  };

  const handleRemoveUrl = (index) => {
    const newUrls = urls.filter((_, i) => i !== index);
    setUrls(newUrls);
  };

  const handleRun = async () => {
    if (!wsConnected) {
      addRunInfo(
        "WebSocket is not connected. Please try again in a few seconds."
      );
      return;
    }

    setIsRunning(true);
    setRunInfo([]);
    setTestStatus("running");
    setTestSummary(null);

    const headersObject = headers.split("\n").reduce((acc, line) => {
      const [key, value] = line.split(":").map((item) => item.trim());
      if (key && value) acc[key] = value;
      return acc;
    }, {});

    const testConfig = {
      loadProfile,
      users,
      duration,
      rampUpDuration: loadProfile === "ramp-up" ? rampUpDuration : undefined,
      urls,
      httpMethod,
      headers: headersObject,
      jsonFile,
    };
    console.log("Test configuration:", testConfig);
    addRunInfo(`Starting test with: ${JSON.stringify(testConfig, null, 2)}`);

    try {
      const response = await fetch("http://localhost:3001/run-test", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(testConfig),
      });

      const result = await response.json();
      if (response.ok) {
        addRunInfo(result.message);
      } else {
        addRunInfo(`Error running test: ${result.error}`);
        setIsRunning(false);
      }
    } catch (error) {
      addRunInfo(`Error running test: ${error.message}`);
      setIsRunning(false);
    }
  };

  const handleCancel = async () => {
    try {
      const response = await fetch("http://localhost:3001/cancel-test", {
        method: "POST",
      });
      const result = await response.json();
      if (response.ok) {
        addRunInfo("Test cancelled by user.");
        setIsRunning(false);
        setTestStatus("cancelled");
      } else {
        addRunInfo(`Error cancelling test: ${result.error}`);
      }
    } catch (error) {
      addRunInfo(`Error cancelling test: ${error.message}`);
    }
  };

  return (
    <div className="max-w-6xl mx-auto p-6 bg-white rounded-lg shadow-lg">
      <h1 className="text-3xl font-bold mb-6 text-att-blue">
        AT&T K6 Performance Testing UI
      </h1>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
        <div>
          <h2 className="text-xl font-semibold mb-4 text-att-blue">
            Test Configuration
          </h2>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Load Profile
              </label>
              <div className="flex space-x-4">
                {["constant", "ramp-up", "step"].map((profile) => (
                  <label key={profile} className="flex items-center space-x-2">
                    <input
                      type="radio"
                      name="loadProfile"
                      value={profile}
                      checked={loadProfile === profile}
                      onChange={(e) => setLoadProfile(e.target.value)}
                      className="form-radio text-att-orange"
                    />
                    <span className="capitalize">{profile}</span>
                  </label>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Duration (seconds)
              </label>
              <div className="flex flex-wrap gap-2">
                {predefinedDurations.map((value) => (
                  <button
                    key={value}
                    onClick={() => updateDurationAndRampUp(value)}
                    className={`px-3 py-1 rounded ${
                      duration === value
                        ? "bg-att-orange text-white"
                        : "bg-gray-200 text-gray-700"
                    }`}
                  >
                    {value}s
                  </button>
                ))}
                <input
                  type="number"
                  value={duration}
                  onChange={(e) =>
                    updateDurationAndRampUp(parseInt(e.target.value))
                  }
                  className="w-20 p-1 border rounded"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Number of Users
              </label>
              <div className="flex flex-wrap gap-2">
                {predefinedUsers.map((value) => (
                  <button
                    key={value}
                    onClick={() => setUsers(value)}
                    className={`px-3 py-1 rounded ${
                      users === value
                        ? "bg-att-orange text-white"
                        : "bg-gray-200 text-gray-700"
                    }`}
                  >
                    {value}
                  </button>
                ))}
                <input
                  type="number"
                  value={users}
                  onChange={(e) => setUsers(parseInt(e.target.value))}
                  className="w-20 p-1 border rounded"
                />
              </div>
            </div>

            {loadProfile === "ramp-up" && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Ramp-up Duration (seconds)
                </label>
                <input
                  type="number"
                  value={rampUpDuration}
                  onChange={(e) => setRampUpDuration(parseInt(e.target.value))}
                  className="w-full p-2 border rounded"
                />
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                HTTP Method
              </label>
              <div className="flex space-x-4">
                {["GET", "POST"].map((method) => (
                  <label key={method} className="flex items-center space-x-2">
                    <input
                      type="radio"
                      name="httpMethod"
                      value={method}
                      checked={httpMethod === method}
                      onChange={(e) => setHttpMethod(e.target.value)}
                      className="form-radio text-att-orange"
                    />
                    <span>{method}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div>
          <h2 className="text-xl font-semibold mb-4 text-att-blue">
            URLs to Test
          </h2>
          <div className="space-y-2">
            {urls.map((url, index) => (
              <div key={index} className="flex space-x-2">
                <input
                  value={url}
                  onChange={(e) => handleUrlChange(index, e.target.value)}
                  placeholder="Enter URL"
                  className="flex-grow p-2 border rounded"
                />
                <button
                  onClick={() => handleRemoveUrl(index)}
                  className="px-3 py-1 bg-red-500 text-white rounded hover:bg-red-600"
                >
                  <X size={16} />
                </button>
              </div>
            ))}
            <button
              onClick={handleAddUrl}
              className="px-3 py-1 bg-att-blue text-white rounded hover:bg-att-blue-dark"
            >
              Add URL
            </button>
          </div>
        </div>
      </div>

      <div className="mb-6">
        <div className="flex items-center space-x-2">
          <input
            type="checkbox"
            checked={showAdvanced}
            onChange={(e) => setShowAdvanced(e.target.checked)}
            className="form-checkbox h-5 w-5 text-att-orange"
          />
          <label className="text-sm font-medium text-gray-700">
            Advanced Options
          </label>
        </div>
        {showAdvanced && (
          <div className="mt-4 space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Headers
              </label>
              <textarea
                value={headers}
                onChange={(e) => setHeaders(e.target.value)}
                className="w-full p-2 border rounded h-32 font-mono text-sm"
                placeholder="Enter headers (one per line, format: Key: Value)"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                JSON File for Request Bodies
              </label>
              <input
                type="file"
                onChange={(e) => setJsonFile(e.target.files[0])}
                accept=".json"
                className="w-full p-2 border rounded"
              />
            </div>
          </div>
        )}
      </div>

      <div className="flex justify-between items-center mb-6">
        <button
          onClick={handleRun}
          disabled={isRunning || !wsConnected}
          className="px-4 py-2 bg-att-orange text-white rounded disabled:bg-gray-400 hover:bg-att-orange-dark flex items-center space-x-2"
        >
          <Play size={16} />
          <span>Run Test</span>
        </button>
        {isRunning && (
          <button
            onClick={handleCancel}
            className="px-4 py-2 bg-red-500 text-white rounded hover:bg-red-600"
          >
            Cancel Test
          </button>
        )}
      </div>

      {!wsConnected && (
        <Alert variant="warning" className="mb-4">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Warning</AlertTitle>
          <AlertDescription>
            WebSocket disconnected. Attempting to reconnect...
          </AlertDescription>
        </Alert>
      )}

      {testStatus === "running" && (
        <Alert variant="info" className="mb-4">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Test in Progress</AlertTitle>
          <AlertDescription>
            Test is running. Check Grafana dashboard for real-time results.
          </AlertDescription>
        </Alert>
      )}

      {testStatus === "completed" && testSummary && (
        <Alert variant="success" className="mb-4">
          <CheckCircle className="h-4 w-4" />
          <AlertTitle>Test Completed</AlertTitle>
          <AlertDescription>
            <ul className="list-disc list-inside">
              <li>Requests made: {testSummary.requestsMade}</li>
              <li>Average response time: {testSummary.avgResponseTime} ms</li>
              <li>Failed responses: {testSummary.failedResponses}</li>
            </ul>
          </AlertDescription>
        </Alert>
      )}

      <div>
        <h2 className="text-xl font-semibold mb-2 text-att-blue">
          Run Information
        </h2>
        <div
          ref={runInfoRef}
          className="bg-gray-900 text-green-400 p-4 rounded h-96 overflow-y-auto font-mono text-sm whitespace-pre"
        >
          {runInfo.map((info, index) => (
            <div key={index} className="mb-1">
              <span className="text-gray-500">[{info.time}]</span>{" "}
              {info.message}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default App;
