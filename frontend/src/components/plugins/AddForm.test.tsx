import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useLocaleStore } from "@/i18n/store";
import { axeViolations } from "@/test/axe";
import { AddForm, fieldsOf, validate } from "./AddForm";
import { sourceText } from "./present";

const fields = (over: Record<string, string> = {}) => ({ name: "", version: "", repo: "", commit: "", subdir: "", path: "", tarball: "", integrity: "", ...over });
const SHA = `sha512-${"A".repeat(86)}==`;

describe("validate: tarball", () => {
  it("an https address ending in .tgz needs a hash, in sha512-, sha256- or hex form", () => {
    const url = "https://example.com/pkg-1.0.0.tgz";
    expect(validate("tarball", fields({ tarball: url })).errors).toEqual({ integrity: "plugins.add.err.integrityRequired" });
    expect(validate("tarball", fields({ tarball: url, integrity: "md5-abc" })).errors).toEqual({ integrity: "plugins.add.err.integrity" });
    expect(validate("tarball", fields({ tarball: url, integrity: SHA })).request).toEqual({ kind: "tarball", spec: url, integrity: SHA });
    expect(validate("tarball", fields({ tarball: url, integrity: `sha256-${"B".repeat(43)}=` })).request).not.toBeNull();
    expect(validate("tarball", fields({ tarball: url, integrity: "a".repeat(64) })).request).not.toBeNull();
    expect(validate("tarball", fields({ tarball: "https://example.com/pkg.tar.gz", integrity: SHA })).request).not.toBeNull();
  });

  it("refuses http, other file types and an https address that is not a .tgz", () => {
    for (const spec of ["http://example.com/a.tgz", "https://example.com/a.zip", "https://example.com/", "ftp://example.com/a.tgz", "a.tgz", "relative/a.tgz"]) {
      expect(validate("tarball", fields({ tarball: spec, integrity: SHA })).errors, spec).toEqual({ tarball: "plugins.add.err.tarball" });
    }
    expect(validate("tarball", fields({})).errors).toEqual({ tarball: "plugins.add.err.tarball" });
  });

  it("accepts an absolute Windows or POSIX path of a .tgz, with the hash optional but checked when given", () => {
    expect(validate("tarball", fields({ tarball: "D:\\plugins\\pkg-1.0.0.tgz" })).request).toEqual({ kind: "tarball", spec: "D:\\plugins\\pkg-1.0.0.tgz" });
    expect(validate("tarball", fields({ tarball: "D:/pkgs/a.tar.gz" })).request).not.toBeNull();
    expect(validate("tarball", fields({ tarball: "/srv/plugins/pkg.tgz", integrity: SHA })).request).toEqual({ kind: "tarball", spec: "/srv/plugins/pkg.tgz", integrity: SHA });
    expect(validate("tarball", fields({ tarball: "/srv/plugins/pkg.tgz", integrity: "nope" })).errors).toEqual({ integrity: "plugins.add.err.integrity" });
    expect(validate("tarball", fields({ tarball: "/srv/plugins/pkg.zip" })).errors).toEqual({ tarball: "plugins.add.err.tarball" });
  });

  it("refuses a UNC path on the client too", () => {
    for (const spec of ["\\\\server\\share\\a.tgz", "//server/share/a.tgz"]) {
      expect(validate("tarball", fields({ tarball: spec })).errors, spec).toEqual({ tarball: "plugins.add.err.tarballUnc" });
    }
  });

  it("fieldsOf fills the form from a tarball request, and sourceText names it", () => {
    expect(fieldsOf({ kind: "tarball", spec: "https://example.com/a.tgz", integrity: SHA })).toMatchObject({ tarball: "https://example.com/a.tgz", integrity: SHA });
    expect(sourceText({ kind: "tarball", spec: "https://example.com/a.tgz" }, "Tarball")).toBe("Tarball https://example.com/a.tgz");
  });
});

describe("AddForm: Tarball tab", () => {
  afterEach(() => {
    cleanup();
    useLocaleStore.setState({ locale: "en" });
  });

  it("shows the address and hash fields, explains what is wrong and submits the request", async () => {
    const onSubmit = vi.fn();
    const { container } = render(<AddForm onSubmit={onSubmit} onCancel={() => {}} />);
    await userEvent.click(screen.getByRole("radio", { name: "Tarball" }));
    await userEvent.click(screen.getByLabelText("Address (https) or absolute path of a .tgz"));
    await userEvent.paste("https://example.com/a-1.0.0.tgz");
    await userEvent.click(screen.getByRole("button", { name: "Check package" }));
    expect(screen.getByText("A web address needs its hash.")).toBeTruthy();
    expect(onSubmit).not.toHaveBeenCalled();
    expect(await axeViolations(container)).toEqual([]);
    await userEvent.click(screen.getByLabelText("Hash (sha512-… or sha256-…, or hex)"));
    await userEvent.paste(SHA);
    await userEvent.click(screen.getByRole("button", { name: "Check package" }));
    expect(onSubmit).toHaveBeenCalledWith({ kind: "tarball", spec: "https://example.com/a-1.0.0.tgz", integrity: SHA });
  });

  it("says the network path is refused, and speaks Portuguese", async () => {
    useLocaleStore.setState({ locale: "pt-BR" });
    render(<AddForm onSubmit={() => {}} onCancel={() => {}} />);
    await userEvent.click(screen.getByRole("radio", { name: "Tarball" }));
    await userEvent.click(screen.getByLabelText("Endereço (https) ou caminho absoluto de um .tgz"));
    await userEvent.paste("\\\\servidor\\x\\a.tgz");
    await userEvent.click(screen.getByRole("button", { name: "Verificar pacote" }));
    expect(screen.getByText(/Caminhos de rede/)).toBeTruthy();
  });
});
