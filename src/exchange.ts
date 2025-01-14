import { pipe, tap, toPromise } from "wonka";
import {
  Exchange,
  Client,
  Operation,
  OperationResult,
  createRequest
} from "urql";
import {
  DevtoolsExchangeOutgoingMessage,
  DevtoolsExchangeOutgoingEventType,
  ExecuteRequestMessage,
  DevtoolsExchangeIncomingEventType
} from "./types";

export const devtoolsExchange: Exchange = ({ client, forward }) => {
  if (process.env.NODE_ENV === "production") {
    return ops$ =>
      pipe(
        ops$,
        forward
      );
  }

  // Listen for messages from content script
  window.addEventListener(
    DevtoolsExchangeIncomingEventType,
    (e: CustomEvent) => {
      const handler = messageHandlers[e.detail.type];
      handler && handler(client)(e.detail);
    }
  );
  sendToContentScript({ type: "init" });

  return ops$ => {
    return pipe(
      ops$,
      tap(handleOperation),
      forward,
      tap(handleOperation)
    );
  };
};

/** Handle operation or response from stream. */
const handleOperation = <T extends Operation | OperationResult>(op: T) => {
  const event = JSON.parse(JSON.stringify(parseStreamData(op))); // Serialization required for some events (such as error)
  sendToContentScript(event);
};

/** Handles execute request messages. */
const requestHandler = (client: Client) => (message: ExecuteRequestMessage) => {
  const isMutation = /(^|\W)+mutation\W/.test(message.query);
  const execFn = isMutation ? client.executeMutation : client.executeQuery;

  pipe(
    execFn(createRequest(message.query), {
      meta: { source: "Devtools" }
    }),
    toPromise
  );
};

/** Map of handlers for incoming messages. */
const messageHandlers = {
  request: requestHandler
} as const;

/** Creates a DevtoolsExchangeOutgoingMessage from operations/responses. */
const parseStreamData = <T extends Operation | OperationResult>(
  op: T
): DevtoolsExchangeOutgoingMessage => {
  const timestamp = new Date().valueOf();

  // Outgoing operation
  if ("operationName" in op) {
    return { type: "operation", data: op as Operation, timestamp } as const;
  }

  // Incoming error
  if ((op as OperationResult).error !== undefined) {
    return { type: "error", data: op as OperationResult, timestamp } as const;
  }

  // Incoming response
  return { type: "response", data: op as OperationResult, timestamp } as const;
};

const sendToContentScript = (detail: DevtoolsExchangeOutgoingMessage) =>
  window.dispatchEvent(
    new CustomEvent(DevtoolsExchangeOutgoingEventType, { detail })
  );
