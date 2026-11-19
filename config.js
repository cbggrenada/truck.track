// CBG Truck Tracker settings. Edit this file in GitHub to change the lists on the form.
// After you commit a change, GitHub Pages updates the site within a minute or two.
window.TRACKER_CONFIG = {
  pickup: "Carib Brewery Plant (main)",
  dropoff: "Warehouse, Frequente",

  // Time slots. Each trip goes into a slot by the time the truck left the plant.
  // start/end are 24-hour clock times; end is not included (9:00 belongs to 9am to 5pm).
  slots: [
    { id: "A", label: "8am to 9am",  start: "08:00", end: "09:00" },
    { id: "B", label: "9am to 5pm",  start: "09:00", end: "17:00" },
    { id: "C", label: "5pm to 11pm", start: "17:00", end: "23:00" }
  ],

  // Trucks that run the plant-to-warehouse route. Add or rename as needed.
  trucks: ["SL107", "SL17"],

  // A round trip longer than this (in minutes) asks the clerk for the reason for the delay before saving. 120 = 2 hours.
  longTripMinutes: 120,

  // Optional: operator names to suggest on the form (people can still type a new name).
  operators: [],

  // The Google Apps Script web app link (ends in /exec) that saves trips to the shared Google Sheet.
  // See README step 1. Leave empty and each device keeps its own trips.
  sheetUrl: "",

  // The admin code that unlocks All trips and Settings is NOT kept here (this file is public).
  // Set it in the Google Sheet's Apps Script as the ADMIN_CODE script property. See README step 1.
  // Only used if sheetUrl is empty (testing on one device): a simple code for that device.
  localCode: ""
};
