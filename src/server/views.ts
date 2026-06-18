import { ServerEvent, ServerMetadata } from "../lib/types.js";

const DEFAULT_EVENT_LIMIT = 20;
const MAX_EVENT_LIMIT = 500;
const DEFAULT_FILE_LIMIT = 500;
const MAX_FILE_LIMIT = 5000;
const DEFAULT_LOG_LINE_LIMIT = 500;
const MAX_LOG_LINE_LIMIT = 2000;

export type ServerViewOptions = {
  include_events?: boolean;
  event_limit?: number;
};

export type EventViewOptions = {
  offset?: number;
  limit?: number;
  tail?: number;
  type?: string;
};

export type FileListViewOptions = {
  offset?: number;
  limit?: number;
  path?: string;
};

export type LogLineViewOptions = {
  max_lines?: number;
};

export function serverView(server: ServerMetadata, options: ServerViewOptions = {}): Record<string, unknown> {
  const { events, ...rest } = server;
  const view: Record<string, unknown> = {
    ...rest,
    event_count: events.length
  };
  if (events.length > 0) {
    view.last_event = events[events.length - 1];
  }
  if (options.include_events) {
    const eventView = eventsView(events, { tail: normalizeLimit(options.event_limit, DEFAULT_EVENT_LIMIT, MAX_EVENT_LIMIT) });
    view.events = eventView.events;
    view.events_truncated = eventView.truncated;
  }
  return view;
}

export function serversView(servers: ServerMetadata[], options: ServerViewOptions = {}): Array<Record<string, unknown>> {
  return servers.map((server) => serverView(server, options));
}

export function eventsView(events: ServerEvent[], options: EventViewOptions = {}): Record<string, unknown> {
  const filtered = options.type ? events.filter((event) => event.type === options.type) : events;
  if (options.tail !== undefined) {
    const limit = normalizeLimit(options.tail, DEFAULT_EVENT_LIMIT, MAX_EVENT_LIMIT);
    const selected = filtered.slice(Math.max(0, filtered.length - limit));
    return {
      total: filtered.length,
      returned: selected.length,
      tail: limit,
      truncated: filtered.length > selected.length,
      events: selected
    };
  }
  const offset = normalizeOffset(options.offset);
  const limit = normalizeLimit(options.limit, DEFAULT_EVENT_LIMIT, MAX_EVENT_LIMIT);
  const selected = filtered.slice(offset, offset + limit);
  return {
    total: filtered.length,
    returned: selected.length,
    offset,
    limit,
    truncated: offset + selected.length < filtered.length,
    events: selected
  };
}

export function fileListView(files: string[], options: FileListViewOptions = {}): Record<string, unknown> {
  const offset = normalizeOffset(options.offset);
  const limit = normalizeLimit(options.limit, DEFAULT_FILE_LIMIT, MAX_FILE_LIMIT);
  const selected = files.slice(offset, offset + limit);
  return {
    path: options.path ?? ".",
    total: files.length,
    returned: selected.length,
    offset,
    limit,
    truncated: offset + selected.length < files.length,
    files: selected
  };
}

export function logLineView<T extends { lines?: string[] }>(result: T, options: LogLineViewOptions = {}): T & Record<string, unknown> {
  if (!Array.isArray(result.lines)) {
    return result;
  }
  const limit = normalizeLimit(options.max_lines, DEFAULT_LOG_LINE_LIMIT, MAX_LOG_LINE_LIMIT);
  if (result.lines.length <= limit) {
    return result;
  }
  return {
    ...result,
    original_line_count: result.lines.length,
    returned_line_count: limit,
    truncated: true,
    lines: result.lines.slice(0, limit)
  };
}

export function boundedLineCount(value: number | undefined, defaultValue: number): number {
  return normalizeLimit(value, defaultValue, MAX_LOG_LINE_LIMIT);
}

function normalizeOffset(value: number | undefined): number {
  return Math.max(0, Number.isFinite(value) ? Math.floor(value as number) : 0);
}

function normalizeLimit(value: number | undefined, defaultValue: number, maxValue: number): number {
  const numeric = Number.isFinite(value) ? Math.floor(value as number) : defaultValue;
  return Math.max(1, Math.min(maxValue, numeric));
}
