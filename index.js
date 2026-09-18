require("dotenv").config();

const http = require("http");
const path = require("path");
const express = require("express");
const { MongoClient } = require("mongodb");
const { nanoid } = require("nanoid");
const WebSocketServer = require("ws").Server;

const app = express();

app.use(express.static(path.join(__dirname, "public")));

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const dbPromise = MongoClient.connect(process.env.MONGO_URI, {
  useUnifiedTopology: true,
  useNewUrlParser: true,
});

const getDbCollection = async () => {
  const dbClient = await dbPromise;
  return dbClient.db().collection("counter");
};

wss.on("connection", (ws) => {
  let sessionId = null;

  ws.on("message", async (data) => {
    try {
      data = JSON.parse(data);
    } catch (err) {
      return;
    }

    switch (data.type) {
      case "init": {
        let count;
        if (data.sessionId) {
          sessionId = data.sessionId;
          const dbCollection = await getDbCollection();
          count = (await dbCollection.findOne({ sessionId })).count;
        } else {
          sessionId = nanoid();
          count = 0;
          const dbCollection = await getDbCollection();
          await dbCollection.insertOne({ sessionId, count: 0 });
        }
        ws.send(
          JSON.stringify({
            type: "ready",
            value: count,
            sessionId,
          })
        );
        break;
      }
      case "dec": {
        if (sessionId === null) {
          return;
        }
        const dbCollection = await getDbCollection();
        const doc = await dbCollection.findOneAndUpdate(
          { sessionId },
          { $inc: { count: -1 } },
          { returnOriginal: false }
        );
        const { count } = doc.value;
        ws.send(
          JSON.stringify({
            type: "value",
            value: count,
          })
        );
        break;
      }
      case "inc": {
        if (sessionId === null) {
          return;
        }
        const dbCollection = await getDbCollection();
        const doc = await dbCollection.findOneAndUpdate(
          { sessionId },
          { $inc: { count: 1 } },
          { returnOriginal: false }
        );
        const { count } = doc.value;
        ws.send(
          JSON.stringify({
            type: "value",
            value: count,
          })
        );
        break;
      }
    }
  });
});

const port = process.env.PORT || 3000;

server.listen(port, () => {
  console.log(` Listening on http://localhost:${port}`);
});
