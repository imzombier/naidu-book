import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import jwt from "jsonwebtoken";
import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();

const app = express();

app.use(cors());
app.use(express.json());

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const db = new Database(
  path.join(__dirname, "naidu.db")
);

// ===============================
// DATABASE
// ===============================

db.exec(`
CREATE TABLE IF NOT EXISTS users(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL,
  coins INTEGER NOT NULL DEFAULT 10000,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS bets(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  stake INTEGER,
  picks TEXT,
  status TEXT,
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS transactions(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  amount INTEGER,
  type TEXT,
  note TEXT,
  created_at TEXT
);
`);

const now = () => new Date().toISOString();

// ===============================
// AUTHENTICATION
// ===============================

const token = (u) =>
  jwt.sign(
    {
      id: u.id,
      email: u.email
    },
    process.env.JWT_SECRET || "dev-secret",
    {
      expiresIn: "7d"
    }
  );

function auth(req, res, next) {
  try {
    const header = req.headers.authorization || "";

    const bearerToken = header.replace("Bearer ", "");

    req.user = jwt.verify(
      bearerToken,
      process.env.JWT_SECRET || "dev-secret"
    );

    next();
  } catch {
    res.status(401).json({
      error: "Authentication required"
    });
  }
}

function user(id) {
  return db
    .prepare(
      "SELECT id,email,coins,created_at FROM users WHERE id=?"
    )
    .get(id);
}

// ===============================
// HEALTH
// ===============================

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    name: "Naidu Book",
    mode: "virtual-coins"
  });
});

// ===============================
// REGISTER
// ===============================

app.post("/api/register", (req, res) => {
  const { email, password } = req.body || {};

  if (
    !email ||
    !password ||
    password.length < 6
  ) {
    return res.status(400).json({
      error: "Email and password (6+ chars) required"
    });
  }

  try {
    const info = db
      .prepare(
        `
        INSERT INTO users
        (email,password,created_at)
        VALUES(?,?,?)
        `
      )
      .run(
        email.toLowerCase(),
        password,
        now()
      );

    const u = user(info.lastInsertRowid);

    db.prepare(
      `
      INSERT INTO transactions
      (user_id,amount,type,note,created_at)
      VALUES(?,?,?,?,?)
      `
    ).run(
      u.id,
      10000,
      "CREDIT",
      "Welcome virtual coins",
      now()
    );

    res.json({
      token: token(u),
      user: u
    });
  } catch {
    res.status(409).json({
      error: "Email already registered"
    });
  }
});

// ===============================
// LOGIN
// ===============================

app.post("/api/login", (req, res) => {
  const {
    email,
    password
  } = req.body || {};

  const u = db
    .prepare(
      `
      SELECT *
      FROM users
      WHERE email=? AND password=?
      `
    )
    .get(
      (email || "").toLowerCase(),
      password
    );

  if (!u) {
    return res.status(401).json({
      error: "Invalid login"
    });
  }

  res.json({
    token: token(u),
    user: user(u.id)
  });
});

// ===============================
// CURRENT USER
// ===============================

app.get("/api/me", auth, (req, res) => {
  res.json(user(req.user.id));
});

// ===============================
// TRANSACTIONS
// ===============================

app.get(
  "/api/transactions",
  auth,
  (req, res) => {
    const transactions = db
      .prepare(
        `
        SELECT *
        FROM transactions
        WHERE user_id=?
        ORDER BY id DESC
        LIMIT 100
        `
      )
      .all(req.user.id);

    res.json(transactions);
  }
);

// ===============================
// BET HISTORY
// ===============================

app.get(
  "/api/bets",
  auth,
  (req, res) => {
    const bets = db
      .prepare(
        `
        SELECT *
        FROM bets
        WHERE user_id=?
        ORDER BY id DESC
        LIMIT 100
        `
      )
      .all(req.user.id);

    res.json(bets);
  }
);

// ===============================
// DEMO TOP-UP
// ===============================

app.post(
  "/api/demo-topup",
  auth,
  (req, res) => {

    db.prepare(
      "UPDATE users SET coins=coins+? WHERE id=?"
    ).run(
      1000,
      req.user.id
    );

    db.prepare(
      `
      INSERT INTO transactions
      (user_id,amount,type,note,created_at)
      VALUES(?,?,?,?,?)
      `
    ).run(
      req.user.id,
      1000,
      "CREDIT",
      "Demo top-up",
      now()
    );

    res.json(
      user(req.user.id)
    );
  }
);

// ===============================
// DEMO BET
// ===============================

app.post(
  "/api/bets",
  auth,
  (req, res) => {

    const {
      stake,
      picks
    } = req.body || {};

    const n = Number(stake);

    if (
      !Number.isInteger(n) ||
      n <= 0 ||
      n > 100000
    ) {
      return res.status(400).json({
        error: "Invalid demo stake"
      });
    }

    const u = user(req.user.id);

    if (u.coins < n) {
      return res.status(400).json({
        error: "Insufficient virtual coins"
      });
    }

    const transaction =
      db.transaction(() => {

        db.prepare(
          `
          UPDATE users
          SET coins=coins-?
          WHERE id=?
          `
        ).run(
          n,
          u.id
        );

        db.prepare(
          `
          INSERT INTO transactions
          (user_id,amount,type,note,created_at)
          VALUES(?,?,?,?,?)
          `
        ).run(
          u.id,
          -n,
          "DEBIT",
          "Demo bet",
          now()
        );

        return db
          .prepare(
            `
            INSERT INTO bets
            (user_id,stake,picks,status,created_at)
            VALUES(?,?,?,?,?)
            `
          )
          .run(
            u.id,
            n,
            JSON.stringify(
              picks || []
            ),
            "DEMO_PENDING",
            now()
          );
      });

    const info = transaction();

    res.json({
      betId: info.lastInsertRowid,
      user: user(u.id)
    });
  }
);

// ===============================
// LIVE ODDS
// ===============================

app.get(
  "/api/odds/:sport",
  async (req, res) => {

    if (!process.env.ODDS_API_KEY) {
      return res.status(503).json({
        error:
          "ODDS_API_KEY not configured"
      });
    }

    try {

      const q =
        new URLSearchParams({
          apiKey:
            process.env.ODDS_API_KEY,

          regions:
            req.query.regions || "eu",

          markets:
            req.query.markets || "h2h",

          oddsFormat:
            "decimal",

          dateFormat:
            "iso"
        });

      const response =
        await fetch(
          "https://api.the-odds-api.com/v4/sports/" +
          encodeURIComponent(req.params.sport) +
          "/odds?" +
          q.toString()
        );

      const data =
        await response.json();

      res
        .status(response.status)
        .json(data);

    } catch (error) {

      res.status(500).json({
        error: error.message
      });

    }
  }
);

// ===============================
// SPORTS LIST
// ===============================

app.get(
  "/api/sports",
  async (req, res) => {

    if (!process.env.ODDS_API_KEY) {
      return res.status(503).json({
        error:
          "ODDS_API_KEY not configured"
      });
    }

    try {

      const q =
        new URLSearchParams({
          apiKey:
            process.env.ODDS_API_KEY
        });

      const response =
        await fetch(
          "https://api.the-odds-api.com/v4/sports?" +
          q.toString()
        );

      const data =
        await response.json();

      res
        .status(response.status)
        .json(data);

    } catch (error) {

      res.status(500).json({
        error: error.message
      });

    }
  }
);

// ===============================
// FRONTEND
// ===============================

const dist =
  path.resolve(
    __dirname,
    "../dist"
  );

app.use(
  express.static(dist)
);

// IMPORTANT:
// Express 5 requires a named wildcard.
app.get(
  "/{*splat}",
  (req, res) => {
    res.sendFile(
      path.join(
        dist,
        "index.html"
      )
    );
  }
);

// ===============================
// START SERVER
// ===============================

const PORT =
  process.env.PORT || 10000;

app.listen(
  PORT,
  "0.0.0.0",
  () => {
    console.log(
      `Naidu Book running on port ${PORT}`
    );
  }
);
