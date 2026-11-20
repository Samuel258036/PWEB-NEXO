CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  username_display TEXT NOT NULL,
  username_key TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE puzzles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  author_id INTEGER NOT NULL REFERENCES users(id),
  name_display TEXT NOT NULL,
  name_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  final_message TEXT,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  published_at TEXT
);

CREATE TABLE steps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  puzzle_id INTEGER NOT NULL REFERENCES puzzles(id) ON DELETE CASCADE,
  position INTEGER NOT NULL CHECK (position >= 1),
  prompt TEXT NOT NULL DEFAULT '',
  answer_text TEXT NOT NULL DEFAULT '',
  answer_key TEXT NOT NULL DEFAULT '',
  first_solved_at TEXT,
  UNIQUE (puzzle_id, position),
  UNIQUE (id, puzzle_id)
);

CREATE TABLE hints (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  step_id INTEGER NOT NULL REFERENCES steps(id) ON DELETE CASCADE,
  position INTEGER NOT NULL CHECK (position >= 1),
  text TEXT NOT NULL,
  UNIQUE (step_id, position)
);

CREATE TABLE progress (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  puzzle_id INTEGER NOT NULL REFERENCES puzzles(id) ON DELETE CASCADE,
  current_step_id INTEGER,
  completed_at TEXT,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (user_id, puzzle_id),
  FOREIGN KEY (current_step_id, puzzle_id) REFERENCES steps(id, puzzle_id),
  CHECK (
    (current_step_id IS NOT NULL AND completed_at IS NULL) OR
    (current_step_id IS NULL AND completed_at IS NOT NULL)
  )
);

CREATE TABLE step_solves (
  progress_id INTEGER NOT NULL REFERENCES progress(id) ON DELETE CASCADE,
  step_id INTEGER NOT NULL REFERENCES steps(id) ON DELETE CASCADE,
  solved_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (progress_id, step_id)
);

CREATE TABLE hint_reveals (
  progress_id INTEGER NOT NULL REFERENCES progress(id) ON DELETE CASCADE,
  hint_id INTEGER NOT NULL REFERENCES hints(id) ON DELETE CASCADE,
  revealed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (progress_id, hint_id)
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY NOT NULL,
  data TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE INDEX puzzles_by_author ON puzzles (author_id);
CREATE INDEX progress_by_puzzle ON progress (puzzle_id);
CREATE INDEX solves_by_step ON step_solves (step_id);
CREATE INDEX reveals_by_hint ON hint_reveals (hint_id);
CREATE INDEX sessions_by_expiration ON sessions (expires_at);
