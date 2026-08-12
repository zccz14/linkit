type RecordValue = Record<string, unknown>

type StreamTextPart = {
  contentIndex: number
  deltas: string[]
  outputIndex: number
  text?: string
}

function recordValue(value: unknown): RecordValue | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as RecordValue)
    : undefined
}

function responseEventValues(responseBody?: string): unknown[] {
  if (!responseBody) return []
  const parsed = parseJson(responseBody)
  if (recordValue(parsed)?.output) return [parsed]
  return responseBody.split(/\r?\n/).flatMap((line) => {
    if (!line.startsWith("data: ")) return []
    try {
      return [JSON.parse(line.slice("data: ".length)) as unknown]
    } catch {
      return []
    }
  })
}

function parseJson(value: string): unknown | undefined {
  try {
    return JSON.parse(value) as unknown
  } catch {
    return undefined
  }
}

function completedResponseOutputParts(value: unknown): string[] {
  const event = recordValue(value)
  const response = recordValue(event?.response) ?? event
  const output = Array.isArray(response?.output) ? response.output : []
  return output.flatMap((item) => {
    const content = recordValue(item)?.content
    if (!Array.isArray(content)) return []
    return content.flatMap((part) => {
      const outputPart = recordValue(part)
      const text = outputPart?.text
      return outputPart?.type === "output_text" && typeof text === "string" && text
        ? [text]
        : []
    })
  })
}

function streamTextParts(events: unknown[]): string[] {
  const parts = new Map<string, StreamTextPart>()

  for (const value of events) {
    const event = recordValue(value)
    if (
      event?.type !== "response.output_text.delta" &&
      event?.type !== "response.output_text.done"
    ) {
      continue
    }

    const outputIndex = event.output_index
    const contentIndex = event.content_index
    if (typeof outputIndex !== "number" || typeof contentIndex !== "number") continue

    const key = `${outputIndex}:${contentIndex}`
    const part = parts.get(key) ?? { contentIndex, deltas: [], outputIndex }
    parts.set(key, part)

    if (event.type === "response.output_text.delta" && typeof event.delta === "string") {
      part.deltas.push(event.delta)
    }
    if (event.type === "response.output_text.done" && typeof event.text === "string") {
      part.text = event.text
    }
  }

  return [...parts.values()]
    .sort(
      (left, right) =>
        left.outputIndex - right.outputIndex || left.contentIndex - right.contentIndex,
    )
    .map((part) => part.text ?? part.deltas.join(""))
    .filter((text) => text.length > 0)
}

export function responseOutputText(responseBody?: string): string | undefined {
  const events = responseEventValues(responseBody)
  const parts = streamTextParts(events)
  if (parts.length > 0) return parts.join("\n\n")

  const completedParts = events.flatMap(completedResponseOutputParts)
  if (completedParts.length > 0) return completedParts.join("\n\n")

  return undefined
}
