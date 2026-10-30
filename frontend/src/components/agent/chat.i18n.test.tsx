import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { QueuedMessages } from "./QueuedMessages";
import { MessageActions } from "./MessageActions";
import { chatCommands } from "./chatCommands";
import { useLocaleStore } from "@/i18n/store";

afterEach(() => act(() => useLocaleStore.getState().setLocale("en")));

describe("chat in pt-BR", () => {
  it("translates the queue and message actions", () => {
    act(() => useLocaleStore.getState().setLocale("pt-BR"));
    render(<><QueuedMessages items={[{ id: "1", text: "oi" } as never]} paused={false} onRemove={vi.fn()} onClear={vi.fn()} onSendNext={vi.fn()} />
      <MessageActions content="x" onReuse={vi.fn()} /></>);
    expect(screen.getByText("Na fila (1): roda depois do turno atual.")).toBeTruthy();
    expect(screen.getByText("Limpar fila")).toBeTruthy();
    expect(screen.getByText("Copiar mensagem")).toBeTruthy();
  });

  it("translates slash command descriptions", () => {
    act(() => useLocaleStore.getState().setLocale("pt-BR"));
    const byName = Object.fromEntries(chatCommands(undefined).map((c) => [c.name, c]));
    expect(byName.new.description).toBe("Começar uma nova conversa; o histórico fica guardado");
  });
});
