require("dotenv").config();

const express = require("express");
const http = require("http");
const nunjucks = require("nunjucks");
const WebSocket = require("ws");
const { nanoid } = require("nanoid");
const cookieParser = require("cookie-parser");
const crypto = require("crypto");
const knex = require("knex");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Nginx terminates HTTPS and forwards requests to this application.
app.set("trust proxy", 1);

const db = knex({
  client: "pg",
  connection: {
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 5432),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
  },
});

nunjucks.configure("views", {
  autoescape: true,
  express: app,
  tags: {
    blockStart: "[%",
    blockEnd: "%]",
    variableStart: "[[",
    variableEnd: "]]",
    commentStart: "[#",
    commentEnd: "#]",
  },
});

app.set("view engine", "njk");

app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(express.static("public"));

const hash = (data) => {
  return crypto.createHash("sha256").update(data).digest("hex");
};

const sessionCookieOptions = {
  httpOnly: true,
  sameSite: "lax",
  secure: process.env.NODE_ENV === "production",
};

const createSession = async (userId) => {
  const sessionId = nanoid();

  await db("sessions").insert({
    user_id: userId,
    session_id: sessionId,
  });

  return sessionId;
};

const findUserBySessionId = async (sessionId) => {
  return db("sessions")
    .join("users", "sessions.user_id", "users.id")
    .select("users.id", "users.username")
    .where("sessions.session_id", sessionId)
    .first();
};

const deleteSession = async (sessionId) => {
  await db("sessions").where({ session_id: sessionId }).delete();
};

const formatTimer = (timer) => {
  const result = {
    id: timer.id,
    userId: timer.user_id,
    start: Number(timer.start),
    description: timer.description,
    isActive: timer.is_active,
  };

  if (timer.end !== null) {
    result.end = Number(timer.end);
  }

  if (timer.duration !== null) {
    result.duration = Number(timer.duration);
  }

  if (timer.is_active) {
    result.progress = Date.now() - Number(timer.start);
  }

  return result;
};

const getTimers = async (userId, isActive) => {
  const query = db("timers").select("*").where({ user_id: userId }).orderBy("id", "asc");

  if (isActive !== undefined) {
    query.andWhere({ is_active: isActive });
  }

  return (await query).map(formatTimer);
};

const sendJson = (ws, message) => {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  }
};

const sendAllTimers = async (ws) => {
  const timers = await getTimers(ws.user.id);
  sendJson(ws, { type: "all_timers", timers });
};

const notifyUser = async (userId) => {
  const sockets = [...wss.clients].filter((ws) => ws.user && ws.user.id === userId);
  await Promise.all(sockets.map(sendAllTimers));
};

wss.on("connection", (ws) => {
  const authTimeout = setTimeout(() => {
    if (!ws.user) {
      ws.close(1008, "Authentication required");
    }
  }, 5000);

  ws.on("message", async (message) => {
    try {
      const data = JSON.parse(message.toString());

      if (ws.user || data.type !== "auth" || !data.token) {
        return sendJson(ws, { type: "auth_error", error: "Authentication required" });
      }

      const user = await findUserBySessionId(data.token);

      if (!user) {
        sendJson(ws, { type: "auth_error", error: "Invalid auth token" });
        return ws.close(1008, "Invalid auth token");
      }

      clearTimeout(authTimeout);
      ws.user = user;
      sendJson(ws, { type: "auth_success" });
      await sendAllTimers(ws);
    } catch (error) {
      console.error("WebSocket message error:", error);
      sendJson(ws, { type: "error", error: "Invalid message" });
    }
  });

  ws.on("close", () => clearTimeout(authTimeout));
  ws.on("error", (error) => console.error("WebSocket error:", error));
});

setInterval(async () => {
  await Promise.all(
    [...wss.clients]
      .filter((ws) => ws.user && ws.readyState === WebSocket.OPEN)
      .map(async (ws) => {
        try {
          const timers = await getTimers(ws.user.id, true);
          sendJson(ws, { type: "active_timers", timers });
        } catch (error) {
          console.error("Cannot send active timers:", error);
        }
      })
  );
}, 1000);

app.use(async (req, res, next) => {
  try {
    const sessionId = req.cookies.sessionId;

    if (sessionId) {
      req.user = await findUserBySessionId(sessionId);
      req.sessionId = sessionId;
    }

    next();
  } catch (error) {
    next(error);
  }
});

const requireAuth = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({
      error: "Unauthorized",
    });
  }

  next();
};

app.get("/", (req, res) => {
  res.render("index", {
    user: req.user,
    userToken: req.sessionId,
    authError: req.query.authError === "true" ? "Wrong username or password" : req.query.authError,
  });
});

app.post("/signup", async (req, res, next) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.redirect("/?authError=Username and password are required");
    }

    const existingUser = await db("users").where({ username }).first();

    if (existingUser) {
      return res.redirect("/?authError=User already exists");
    }

    const [user] = await db("users")
      .insert({
        username,
        password: hash(password),
      })
      .returning(["id", "username"]);

    const sessionId = await createSession(user.id);

    res.cookie("sessionId", sessionId, sessionCookieOptions);

    res.redirect("/");
  } catch (error) {
    if (error.code === "23505") {
      return res.redirect("/?authError=User already exists");
    }

    next(error);
  }
});

app.post("/login", async (req, res, next) => {
  try {
    const { username, password } = req.body;

    const user = await db("users")
      .where({
        username,
        password: hash(password),
      })
      .first();

    if (!user) {
      return res.redirect("/?authError=true");
    }

    const sessionId = await createSession(user.id);

    res.cookie("sessionId", sessionId, sessionCookieOptions);

    res.redirect("/");
  } catch (error) {
    next(error);
  }
});

app.get("/logout", async (req, res, next) => {
  try {
    const sessionId = req.cookies.sessionId;

    if (sessionId) {
      await deleteSession(sessionId);
    }

    res.clearCookie("sessionId", sessionCookieOptions);
    res.redirect("/");
  } catch (error) {
    next(error);
  }
});

app.get("/api/timers", requireAuth, async (req, res, next) => {
  try {
    const { isActive } = req.query;

    if (isActive !== undefined) {
      if (isActive !== "true" && isActive !== "false") {
        return res.status(400).json({
          error: "isActive must be true or false",
        });
      }

    }
    res.json(await getTimers(req.user.id, isActive === undefined ? undefined : isActive === "true"));
  } catch (error) {
    next(error);
  }
});

app.post("/api/timers", requireAuth, async (req, res, next) => {
  try {
    const { description } = req.body;

    if (!description) {
      return res.status(400).json({
        error: "Description is required",
      });
    }

    const [timer] = await db("timers")
      .insert({
        user_id: req.user.id,
        start: Date.now(),
        description,
        is_active: true,
      })
      .returning("*");

    await notifyUser(req.user.id);
    res.status(201).json(formatTimer(timer));
  } catch (error) {
    next(error);
  }
});

app.post("/api/timers/:id/stop", requireAuth, async (req, res, next) => {
  try {
    const { id } = req.params;

    const timer = await db("timers")
      .where({
        id,
        user_id: req.user.id,
      })
      .first();

    if (!timer) {
      return res.status(404).json({
        error: "Timer not found",
      });
    }

    if (!timer.is_active) {
      return res.status(400).json({
        error: "Timer already stopped",
      });
    }

    const end = Date.now();
    const duration = end - Number(timer.start);

    const [updatedTimer] = await db("timers")
      .where({
        id,
        user_id: req.user.id,
      })
      .update({
        end,
        duration,
        is_active: false,
      })
      .returning("*");

    await notifyUser(req.user.id);
    res.json(formatTimer(updatedTimer));
  } catch (error) {
    next(error);
  }
});

app.use((error, req, res, next) => {
  void next;
  console.error(error);

  res.status(500).json({
    error: "Internal server error",
  });
});

const port = process.env.PORT || 3000;

server.listen(port, () => {
  console.log(`Listening on http://localhost:${port}`);
});
