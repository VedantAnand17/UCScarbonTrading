import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(() => {
  cleanup();
  sessionStorage.clear();
});

// jsdom does not implement the modal dialog methods.
HTMLDialogElement.prototype.showModal ??= function () { this.open = true; };
HTMLDialogElement.prototype.close ??= function () { this.open = false; };
