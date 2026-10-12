# Visual generation and approval

Step 5 stores generated images, diagrams, charts, maps and molecules as previews. Generation does not insert Markdown into document sections. A proposal in the `generada` state contains the generated `markdown`, plus its resource path and attribution when applicable.

The user can inspect the preview, discard it, edit the proposal or regenerate it. Editing generation inputs invalidates the preview. New image generations use separate resource filenames so they cannot overwrite an already approved image.

The **Aceptar** action inserts the stored preview at the proposal's anchor, or replaces the specified broken image. Approval is serialized and repeated approvals do not insert duplicates. Pending previews survive reloads and history cleanup. Existing inserted visuals remain in the document.

Tests cover deferred generation, durable previews, concurrent approval, discarded/edited previews, direct molecule generation and image insertion. A fictional-data Electron check also verifies that a Mermaid diagram and local image are visible in Step 5 before approval, and that approving one leaves the other pending.
