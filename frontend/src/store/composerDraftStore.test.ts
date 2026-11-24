import { beforeEach, describe, expect, it } from "vitest";
import { useComposerDraftStore } from "./composerDraftStore";

describe("composerDraftStore", () => {
  beforeEach(() => {
    sessionStorage.clear();
    useComposerDraftStore.setState({ drafts: {} });
  });

  it("keeps a draft per thread and drops an emptied one", () => {
    const { setDraft } = useComposerDraftStore.getState();
    setDraft("new", "ola");
    setDraft("t-1", "outro");
    expect(useComposerDraftStore.getState().drafts).toEqual({ new: "ola", "t-1": "outro" });
    setDraft("new", "");
    expect(useComposerDraftStore.getState().drafts).toEqual({ "t-1": "outro" });
  });

  it("moves the draft of a new chat to the thread born from it, without overwriting one that is there", () => {
    const { setDraft, moveDraft } = useComposerDraftStore.getState();
    setDraft("new", "texto");
    moveDraft("new", "t-9");
    expect(useComposerDraftStore.getState().drafts).toEqual({ "t-9": "texto" });
    setDraft("new", "de novo");
    moveDraft("new", "t-9");
    expect(useComposerDraftStore.getState().drafts).toEqual({ "t-9": "texto" });
  });

  it("survives the composer unmounting and mounting again (session storage)", async () => {
    useComposerDraftStore.getState().setDraft("t-1", "rascunho");
    const stored = sessionStorage.getItem("oh.composer-drafts") ?? "{}";
    expect(JSON.parse(stored).state.drafts).toEqual({ "t-1": "rascunho" });
    // The page is left: memory goes, the session's storage stays; coming back reads it again.
    useComposerDraftStore.setState({ drafts: {} });
    sessionStorage.setItem("oh.composer-drafts", stored);
    await useComposerDraftStore.persist.rehydrate();
    expect(useComposerDraftStore.getState().drafts).toEqual({ "t-1": "rascunho" });
  });
});
