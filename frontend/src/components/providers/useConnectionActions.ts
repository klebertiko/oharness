"use client";
import { useState } from "react";
import { specOf, useProviderStore, type Connection } from "./providerStore";
import { nextStep, type NextStep } from "./nextStep";

export const KEY_FIELD_ID = "oh-provider-key";
export const ENDPOINT_FIELD_ID = "oh-provider-endpoint";
export const MODEL_PICKER_ATTR = "data-provider-model";

const focusField = (el: HTMLElement | null) => {
  el?.scrollIntoView?.({ block: "center", behavior: "smooth" });
  el?.focus({ preventScroll: true });
};

/**
 * Everything one connection's screen does besides showing it: test, run its
 * one next step, save the endpoint draft. The endpoint field edits a draft;
 * the sidecar row (what probes and runs read) changes only on a confirmed save
 * (blur, Enter, or before a Test), so a test always runs against the endpoint
 * on screen, never a stale one. Credentials never pass through here: the key
 * field hands its value straight to `attachSecret` (ADR 0001).
 */
export function useConnectionActions(c: Connection) {
  const { probe, saveEndpoint, toggleEnabled } = useProviderStore();
  const spec = specOf(c);
  const [draft, setDraft] = useState<{ id: string; value: string } | null>(null);
  const [endpointSave, setEndpointSave] = useState<{ id: string; state: "saving" | "saved" | "failed" } | null>(null);
  const [copied, setCopied] = useState<{ id: string; text: string } | null>(null);
  const [replacingId, setReplacingId] = useState<string | null>(null);

  const endpointValue = draft?.id === c.id ? draft.value : c.endpoint;
  const endpointState = endpointSave?.id === c.id ? endpointSave.state : null;

  /** Save a pending endpoint edit; true when nothing is pending or it saved. */
  const commitEndpoint = async (): Promise<boolean> => {
    if (!spec.endpoint.editable || endpointValue.trim() === c.endpoint) return true;
    setEndpointSave({ id: c.id, state: "saving" });
    const saved = await saveEndpoint(c.id, endpointValue);
    setEndpointSave({ id: c.id, state: saved ? "saved" : "failed" });
    if (saved) setDraft(null);
    return saved;
  };

  const test = async () => {
    if (await commitEndpoint()) await probe(c.id);
  };

  /** Turn on, then test: one flow, the promise the chat combo's inline setup makes. */
  const turnOnThenTest = async () => {
    if (await commitEndpoint()) {
      await toggleEnabled(c.id);
      await probe(c.id);
    }
  };

  const runStep = (step: NextStep | null = nextStep(c)) => {
    if (!step) return;
    switch (step.kind) {
      case "paste":
        focusField(document.getElementById(KEY_FIELD_ID));
        break;
      case "replaceKey":
        setReplacingId(c.id); // the key field mounts focused
        break;
      case "checkEndpoint":
        focusField(document.getElementById(ENDPOINT_FIELD_ID));
        break;
      case "copy":
        if (step.copy) {
          const text = step.copy;
          void navigator.clipboard?.writeText(text).then(
            () => setCopied({ id: c.id, text }),
            () => setCopied(null),
          );
        }
        break;
      case "link":
        if (step.href) window.open(step.href, "_blank", "noopener,noreferrer");
        break;
      case "turnOn":
        void turnOnThenTest();
        break;
      case "model":
        focusField(document.querySelector<HTMLElement>(`[${MODEL_PICKER_ATTR}] button`));
        break;
      default:
        void test();
    }
  };

  return {
    endpointValue,
    endpointState,
    editEndpoint: (value: string) => {
      setDraft({ id: c.id, value });
      setEndpointSave(null);
    },
    commitEndpoint,
    test,
    runStep,
    copied: copied?.id === c.id ? copied.text : null,
    replacing: replacingId === c.id,
    setReplacing: (on: boolean) => setReplacingId(on ? c.id : null),
  };
}

export type ConnectionActions = ReturnType<typeof useConnectionActions>;
