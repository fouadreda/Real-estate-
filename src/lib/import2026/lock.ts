/**
 * The 2026 Excel data is fully imported and reconciled, and staff now correct records in the app.
 * Writing again would undo or duplicate those corrections (the importer matches records by date and
 * amount), so writes are locked; the preview still compares the app with the Excel. To load a new set
 * of statements later, make the importer keep app corrections first, then set this to false.
 */
export const IMPORT_WRITES_LOCKED = true;
