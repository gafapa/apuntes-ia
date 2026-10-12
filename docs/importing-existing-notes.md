# Importing existing notes

Use **Import existing notes** from a subject. The import dialog keeps file conversion,
PDF transcription, progress, failures and retry actions together.
It stays open after uploading and offers explicit actions to open the notes or exercises.
Uploading, transcription, queued work and diagnosis all keep the modal in its processing
state. Escape, backdrop clicks and document navigation cannot dismiss it during these
stages. **Continue in the background** is the explicit way to leave after uploading;
otherwise the report remains open until processing finishes and the user closes it.
The document's **Import** button reopens the report, including work still in progress.

Importing preserves the existing document rather than starting index generation or
rewriting. Further generation and revision remain available as separate document actions.
The optional import diagnosis is available in step 4, **Review**, where its issues
can launch focused corrections and navigate to the appropriate document tools. The
import report links directly to Review.

Explicit exercise headings and standalone exercise labels are extracted locally into
activity blocks. Explanations stay in the note sections; recognizable solution blocks
are retained with the exercises. The original Markdown for an activity is used for
preview and export, preserving tables, images, formatting and footnotes. Numbered
solutions are associated with matching numbered prompts when that association is explicit.
The source file and its converted Markdown remain in the document's `original/` folder.

Classification is conservative and based on labels, not on an AI interpretation of
every paragraph. Worked examples, code and ambiguous unlabeled content remain in the
notes. Review the imported activities and solutions before export. PDF transcription
uses the configured agent and the existing permissions. Embedded RGB, grayscale and
transparent raster images are extracted locally as PNG files before transcription.
Repeated images share a resource; the page inventory is saved in `pdf-images.json`.
The agent must insert these resources in the text or exercises, and transcription
cannot finish while an extracted image is missing from its Markdown. Vector drawings
and stencil masks require review; previously imported PDFs need a fresh import to
recover their images without overwriting subsequent edits.

Checks: `npm run typecheck` and `npm test`. The import regression tests cover mixed
content, activity-only documents, footnotes, images, tables, solution export, worked
examples, code, import-only mode and PDF post-processing with fictitious content.
