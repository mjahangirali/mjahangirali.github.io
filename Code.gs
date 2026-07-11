// Nayatel DVR - Apps Script backend
// Serves the form (doGet), verifies employees, appends submissions, and
// powers the personal/team/nationwide dashboard.

var SHEET_NAME = 'Entries';
var EMPLOYEES_SHEET_NAME = 'Employees';

// CRM IDs in this list see NATIONWIDE data regardless of their Role/Region.
// Add more CRM IDs here (lowercase or not, comparison is case-insensitive) as needed.
var NATIONWIDE_ADMIN_IDS = ['jahangir.ali'];

var COLUMNS = [
  'Submitted At', 'Date', 'Time', 'CRM ID', 'Employee Name', 'SAP Number', 'City',
  'Mobile Number', 'Email',
  'Customer Type', 'Interaction Type', 'Visit Type',
  'Customer Name', 'Customer Contact', 'Customer Email', 'Address',
  'Package Category', 'Package Interested', 'MRC',
  'SOI', 'Status', 'User ID', 'Selected Package',
  'Brochures Dropped', 'Remarks',
  'Latitude', 'Longitude', 'GPS Accuracy', 'GPS Timestamp', 'Maps URL',
  'Entry ID'
];

var EMPLOYEES_HEADERS = ['CRM ID', 'Employee Name', 'SAP Number', 'City', 'Mobile Number', 'Email', 'Role', 'Reports To', 'Region', 'Password'];

// Sign in using company email OR mobile number + password.
// Returns the employee profile if credentials match, or an error object.
// ── Password hashing (SHA-256) ──────────────────────────
function hashPassword_(pwd) {
  try {
    var bytes = Utilities.computeDigest(
      Utilities.DigestAlgorithm.SHA_256,
      String(pwd),
      Utilities.Charset.UTF_8
    );
    return bytes.map(function(b){ return ('0'+(b&0xFF).toString(16)).slice(-2); }).join('');
  } catch(e) { return String(pwd); }
}

function pwdMatch_(input, stored) {
  // Support both hashed (64-char hex) and plain-text (legacy/temp)
  var hashed = hashPassword_(input);
  if (stored.length === 64) return hashed === stored;   // hashed stored
  return String(input) === String(stored);              // plain-text (temp or legacy)
}

function signIn(identifier, password) {
  try {
    var data = getEmployeesData_();
    var idLower = String(identifier || '').trim().toLowerCase();
    var pwd     = String(password   || '').trim();

    for (var i = 1; i < data.length; i++) {
      var email   = String(data[i][5] || '').trim().toLowerCase();
      var mobile  = String(data[i][4] || '').trim();
      var crmId   = String(data[i][0] || '').trim().toLowerCase();
      if (email !== idLower && mobile !== idLower && crmId !== idLower) continue;

      var stored = String(data[i][9] || '').trim();
      if (stored === '') return { error: 'no_password', msg: 'No password set. Contact your administrator.' };
      if (!pwdMatch_(pwd, stored)) return { error: 'wrong_password', msg: 'Incorrect password. Please try again.' };

      // Column 11 (L) = Password Changed flag.  Empty = treat as Yes (legacy users).
      var pwdChanged = String(data[i][11] || 'Yes').trim().toLowerCase();
      var firstLogin = (pwdChanged === 'no');

      return {
        firstLogin:   firstLogin,
        rowIndex:     i,              // needed for changePassword
        crmId:        data[i][0],
        empName:      data[i][1],
        sapNumber:    data[i][2],
        empCity:      data[i][3],
        mobileNumber: data[i][4],
        email:        data[i][5],
        role:         (data[i][6] || 'Employee').toString().trim() || 'Employee',
        reportsTo:    data[i][7],
        region:       data[i][8]
      };
    }
    return { error: 'not_found', msg: 'No account found for this identifier.' };
  } catch (err) {
    return { error: 'server_error', msg: 'Server error: ' + err.message };
  }
}

// Change password on first login
function changePassword(crmId, currentPwd, newPwd) {
  try {
    var sheet = getOrCreateSheet_(EMPLOYEES_SHEET_NAME, EMPLOYEES_HEADERS);
    var data = sheet.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][0]).trim().toLowerCase() !== String(crmId).trim().toLowerCase()) continue;
      var stored = String(data[i][9] || '').trim();
      if (!pwdMatch_(String(currentPwd).trim(), stored))
        return { error: 'Current password is incorrect.' };
      var hashed = hashPassword_(String(newPwd).trim());
      var jCell = sheet.getRange(i+1, 10);
      jCell.clearDataValidations();          // remove dropdown restriction on col J
      jCell.setValue(hashed);                // store hashed password
      sheet.getRange(i+1, 12).setValue('Yes');                        // col L = Password Changed
      invalidateEmployeesCache_();
      sheet.getRange(i+1, 13).setValue(String(newPwd).trim());        // col M = plain text
      return { ok: true };
    }
    return { error: 'Account not found.' };
  } catch(e) { return { error: 'changePassword: ' + e.message }; }
}

// Admin: reset a user password to a new temporary password
function adminResetPassword(adminCrmId, targetCrmId, tempPassword) {
  try {
    if (!isNationwideAdmin_(adminCrmId)) return { error: 'Permission denied.' };
    var sheet = getOrCreateSheet_(EMPLOYEES_SHEET_NAME, EMPLOYEES_HEADERS);
    var data = sheet.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][0]).trim().toLowerCase() !== String(targetCrmId).trim().toLowerCase()) continue;
      var jCell2 = sheet.getRange(i+1, 10);
      jCell2.clearDataValidations();
      jCell2.setValue(String(tempPassword).trim()); // plain temp password
      invalidateEmployeesCache_();
      sheet.getRange(i+1, 12).setValue('No');       // force change on next login
      return { ok: true };
    }
    return { error: 'User not found.' };
  } catch(e) { return { error: 'adminResetPassword: ' + e.message }; }
}

function doGet(e) {
  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle('Nayatel - Sales Entry (DVR)')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

// Returns a simple object to confirm the deployed version is current.
// The client checks this on startup so stale deployments are immediately obvious.
function pingServer() {
  var tz = Session.getScriptTimeZone();
  return {
    version: '3.0',
    timestamp: Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd HH:mm:ss'),
    ok: true
  };
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

function getOrCreateSheet_(name, headers) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(headers);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

// ---------- Cached Employees data ----------
// request (getProfile + dashboard/report passes). Caching its raw values in
// CacheService turns repeated slow Sheets reads into a single fast lookup.
var _empDataMemo = null;  // per-execution memo (avoids re-parsing within one call)
function getEmployeesData_() {
  if (_empDataMemo) return _empDataMemo;          // same-execution reuse
  try {
    var cache = CacheService.getScriptCache();
    var cached = cache.get('emp_data_v1');
    if (cached) {
      _empDataMemo = JSON.parse(cached);
      return _empDataMemo;
    }
  } catch (e) {}
  var sheet = getOrCreateSheet_(EMPLOYEES_SHEET_NAME, EMPLOYEES_HEADERS);
  var data = sheet.getDataRange().getValues();
  _empDataMemo = data;
  try {
    CacheService.getScriptCache().put('emp_data_v1', JSON.stringify(data), 300); // 5 min TTL
  } catch (e) {}  // value may exceed 100KB cache limit on huge teams -> just skip caching
  return data;
}
function invalidateEmployeesCache_() {
  _empDataMemo = null;
  try { CacheService.getScriptCache().remove('emp_data_v1'); } catch (e) {}
}

// ---------- Employees / verification ----------

function getProfile(crmId) {
  var data = getEmployeesData_();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]).trim().toLowerCase() === String(crmId).trim().toLowerCase()) {
      return {
        crmId: data[i][0],
        empName: data[i][1],
        sapNumber: data[i][2],
        empCity: data[i][3],
        mobileNumber: data[i][4],
        email: data[i][5],
        role: (data[i][6] || 'Employee').toString().trim() || 'Employee',
        reportsTo: data[i][7],
        region: data[i][8]
      };
    }
  }
  return null;
}

function getAllEmployees_() {
  var sheet = getOrCreateSheet_(EMPLOYEES_SHEET_NAME, EMPLOYEES_HEADERS);
  var data = sheet.getDataRange().getValues();
  var list = [];
  for (var i = 1; i < data.length; i++) {
    if (!data[i][0]) continue;
    list.push({
      crmId: data[i][0],
      empName: data[i][1],
      sapNumber: data[i][2],
      empCity: data[i][3],
      mobileNumber: data[i][4],
      email: data[i][5],
      role: (data[i][6] || 'Employee').toString().trim() || 'Employee',
      reportsTo: data[i][7],
      region: data[i][8]
    });
  }
  return list;
}

function isNationwideAdmin_(crmId) {
  var lower = String(crmId || '').trim().toLowerCase();
  return NATIONWIDE_ADMIN_IDS.some(function(id) { return id.trim().toLowerCase() === lower; });
}

// Resolves which CRM IDs a viewer is allowed to see, based on their role:
// - Nationwide Admin (CRM ID in NATIONWIDE_ADMIN_IDS): everyone, company-wide
// - Regional Manager: everyone (incl. themselves) whose Region matches theirs
// - Supervisor: themselves + everyone whose "Reports To" matches their CRM ID
// - Employee: just themselves
function getScopedEmployees_(profile) {
  var all = getAllEmployees_();

  if (isNationwideAdmin_(profile.crmId)) {
    return all.length ? all : [profile];
  }

  var role = (profile.role || 'Employee').trim();
  var crmIdLower = String(profile.crmId).trim().toLowerCase();

  if (role === 'Regional Manager') {
    var region = String(profile.region || '').trim().toLowerCase();
    var inRegion = all.filter(function(e) {
      return String(e.region || '').trim().toLowerCase() === region && region !== '';
    });
    if (inRegion.length === 0) inRegion = [profile];
    return inRegion;
  }

  if (role === 'Supervisor') {
    var directReports = all.filter(function(e) {
      return String(e.reportsTo || '').trim().toLowerCase() === crmIdLower;
    });
    var self = all.filter(function(e) { return String(e.crmId).trim().toLowerCase() === crmIdLower; });
    var combined = self.concat(directReports);
    if (combined.length === 0) combined = [profile];
    return combined;
  }

  return [profile];
}

function effectiveRoleLabel_(profile) {
  if (isNationwideAdmin_(profile.crmId)) return 'Nationwide Admin';
  return (profile.role || 'Employee').trim();
}

// ---------- Submissions ----------

// ---------- AppSheet integration: Entry ID backfill ----------
// Run ONCE from the Apps Script editor after deploying, to give every existing
// entry a permanent unique ID. Safe to run multiple times (only fills blanks).
function backfillEntryIds() {
  var sheet = getOrCreateSheet_(SHEET_NAME, COLUMNS);
  var data = sheet.getDataRange().getValues();
  if (data.length < 2) return 'No entries to backfill.';
  var headers = data[0], col = {};
  headers.forEach(function(h, i){ col[String(h).trim()] = i; });
  var idCol = col['Entry ID'];
  if (idCol === undefined) return 'Entry ID column missing — check COLUMNS + redeploy.';
  var filled = 0;
  for (var i = 1; i < data.length; i++) {
    if (!String(data[i][idCol] || '').trim()) {
      sheet.getRange(i + 1, idCol + 1).setValue(Utilities.getUuid());
      filled++;
    }
  }
  return 'Backfilled ' + filled + ' entries with Entry IDs.';
}

function submitEntry(record) {
  // Idempotency guard for offline sync retries: if the client already sent
  // this exact entry (same clientEntryId) and it succeeded, don't append a
  // second row — just report success again. Without this, a flaky network
  // (request succeeds server-side but the success response never reaches
  // the client) would cause the offline queue to retry and create a
  // duplicate visit report.
  var clientEntryId = String(record.clientEntryId || '').trim();
  if (clientEntryId) {
    var cache = CacheService.getScriptCache();
    var cacheKey = 'submitted_entry_' + clientEntryId;
    if (cache.get(cacheKey)) {
      return { ok: true, duplicate: true };
    }
  }

  var sheet = getOrCreateSheet_(SHEET_NAME, COLUMNS);
  sheet.appendRow([
    new Date(),
    record.date,
    record.time,
    record.crmId,
    record.empName,
    record.sapNumber,
    record.city,
    record.mobileNumber,
    record.email,
    record.customerType,
    record.contactMode,
    record.visitType,
    record.customerName,
    record.customerContact,
    record.customerEmail,
    record.address,
    record.packageCategory,
    record.packageInterested,
    record.mrc,
    record.soi,
    record.status,
    record.userId,
    record.selectedPackage,
    record.brochuresDropped,
    record.remarks,
    record.latitude || '',
    record.longitude || '',
    record.gpsAccuracy || '',
    record.gpsTimestamp || '',
    record.mapsUrl || '',
    Utilities.getUuid()
  ]);

  if (clientEntryId) {
    try { CacheService.getScriptCache().put('submitted_entry_' + clientEntryId, '1', 21600); } catch (e) {} // 6h max TTL
  }
  return { ok: true };
}

// Checks whether a contact number already exists anywhere in Entries
// (across all dates and employees) - used for the inline duplicate warning
// while filling out the Customer Contact field.
function checkDuplicateContact(contact) {
  var sheet = getOrCreateSheet_(SHEET_NAME, COLUMNS);
  var data = sheet.getDataRange().getValues();
  var headers = data[0];
  var col = {};
  headers.forEach(function(h, i) { col[h] = i; });
  var target = String(contact).trim();
  if (!target) return { exists: false, count: 0 };

  var count = 0;
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][col['Customer Contact']]).trim() === target) count++;
  }
  return { exists: count > 0, count: count };
}

function getServerDateTime() {
  var now = new Date();
  var tz = Session.getScriptTimeZone();
  return {
    date: Utilities.formatDate(now, tz, 'yyyy-MM-dd'),
    time: Utilities.formatDate(now, tz, 'hh:mm a')
  };
}

// ---------- Dashboard ----------

function normalizeDateStr_(value) {
  if (Object.prototype.toString.call(value) === '[object Date]') {
    return Utilities.formatDate(value, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  return String(value).trim();
}

var DVR_TARGET = 10;        // per day per employee
var SQ_TARGET  = 6;         // per day per employee
var DVR_WEEKLY  = 50;       // 10 * 5 days
var SQ_WEEKLY   = 30;       // 6  * 5 days
var DVR_MONTHLY = 240;      // fixed monthly target
var SQ_MONTHLY  = 132;      // fixed monthly target
var D2D_DAILY_TARGET   = 300;    // D2D brochures per day per employee
var D2D_WEEKLY_TARGET  = 2000;   // per week
var D2D_MONTHLY_TARGET = 8000;   // per month

function getDashboardData(crmId) {
  try {
    var profile = getProfile(crmId);
    if (!profile) {
      return { error: 'Employee not found for CRM ID: ' + crmId };
    }
    return buildDashboardData_(profile);
  } catch (err) {
    return { error: 'Server error in getDashboardData: ' + err.message + ' | stack: ' + (err.stack || 'n/a') };
  }
}

function buildDashboardData_(profile) {
  var scopedEmployees = getScopedEmployees_(profile);
  var scopedIds = {};
  scopedEmployees.forEach(function(e) { scopedIds[String(e.crmId).trim().toLowerCase()] = true; });

  var sheet = getOrCreateSheet_(SHEET_NAME, COLUMNS);
  var data = sheet.getDataRange().getValues();
  var headers = data[0];
  var col = {};
  headers.forEach(function(h, i) { col[h] = i; });

  var tz = Session.getScriptTimeZone();
  var today = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');

  var rows = [];
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    var rowCrmId = String(row[col['CRM ID']]).trim().toLowerCase();
    if (scopedIds[rowCrmId] && normalizeDateStr_(row[col['Date']]) === today) {
      rows.push(row);
    }
  }

  var role = effectiveRoleLabel_(profile);
  var teamSize = scopedEmployees.length;
  var scopeLabel = role === 'Nationwide Admin' ? 'Nationwide'
                  : role === 'Regional Manager' ? 'Your region'
                  : role === 'Supervisor' ? 'Your team'
                  : 'You';

  var dvrCount = 0;
  var uniqueContacts = {};
  var matureContacts = {};
  var brochures = 0;

  // Count occurrences of every contact number seen today (within scope) to flag duplicates.
  var contactOccurrences = {};
  rows.forEach(function(row) {
    var c = String(row[col['Customer Contact']]).trim();
    if (c) contactOccurrences[c] = (contactOccurrences[c] || 0) + 1;
  });

  var byPerson = {};
  scopedEmployees.forEach(function(e) {
    byPerson[String(e.crmId).trim().toLowerCase()] = {
      crmId: e.crmId, empName: e.empName,
      dvrCount: 0, uniqueContacts: {}, matureContacts: {}, brochures: 0
    };
  });

  rows.forEach(function(row) {
    var rowCrmId = String(row[col['CRM ID']]).trim().toLowerCase();
    var person = byPerson[rowCrmId];
    var contact = String(row[col['Customer Contact']]).trim();
    var isPhysical = row[col['Interaction Type']] === 'Physical Visit';
    var isMature = row[col['Status']] === 'Mature';
    var droppedBrochures = Number(row[col['Brochures Dropped']]) || 0;

    if (isPhysical) dvrCount++;
    if (contact) uniqueContacts[contact] = true;
    if (isMature && contact) matureContacts[contact] = true;
    brochures += droppedBrochures;

    if (person) {
      if (isPhysical) person.dvrCount++;
      if (contact) person.uniqueContacts[contact] = true;
      if (isMature && contact) person.matureContacts[contact] = true;
      person.brochures += droppedBrochures;
    }
  });

  var salesQueueCount = Object.keys(uniqueContacts).length;
  var matureCount = Object.keys(matureContacts).length;

  var breakdown = Object.keys(byPerson).map(function(key) {
    var p = byPerson[key];
    return {
      crmId: p.crmId,
      empName: p.empName,
      dvrCount: p.dvrCount,
      salesQueueCount: Object.keys(p.uniqueContacts).length,
      matureCount: Object.keys(p.matureContacts).length,
      brochures: p.brochures
    };
  }).sort(function(a, b) { return String(a.empName).localeCompare(String(b.empName)); });

  var recentLimit = role === 'Employee' ? 8 : 15;
  var recent = rows
    .map(function(row) {
      var contact = String(row[col['Customer Contact']] || '').trim();
      var rawDate = row[col['Submitted At']];
      // Convert Date objects to ISO string - raw Date objects break JSON serialization.
      var submittedAt = (rawDate instanceof Date) ? rawDate.toISOString() : String(rawDate || '');
      return {
        empName: String(row[col['Employee Name']] || ''),
        time: String(row[col['Time']] || ''),
        contact: contact,
        isDuplicate: (contactOccurrences[contact] || 0) > 1,
        status: String(row[col['Status']] || ''),
        contactMode: String(row[col['Interaction Type']] || ''),
        visitType: String(row[col['Visit Type']] || ''),
        packageInterested: String(row[col['Package Interested']] || ''),
        submittedAt: submittedAt
      };
    })
    .sort(function(a, b) { return new Date(b.submittedAt) - new Date(a.submittedAt); })
    .slice(0, recentLimit);

  var scaleFactor = role === 'Employee' ? 1 : teamSize;
  var dvrTarget = DVR_TARGET * scaleFactor;
  var salesQueueTarget = SQ_TARGET * scaleFactor;

  var dvrPct = Math.min(100, Math.round((dvrCount / dvrTarget) * 100));
  var salesPct = Math.min(100, Math.round((salesQueueCount / salesQueueTarget) * 100));
  var overallPct = Math.round(((dvrCount / dvrTarget) + (salesQueueCount / salesQueueTarget)) / 2 * 100);
  overallPct = Math.max(0, Math.min(100, overallPct));

  return {
    date: today,
    role: role,
    scopeLabel: scopeLabel,
    teamSize: teamSize,
    dvrCount: dvrCount, dvrTarget: dvrTarget, dvrPct: dvrPct,
    salesQueueCount: salesQueueCount, salesQueueTarget: salesQueueTarget, salesPct: salesPct,
    matureCount: matureCount,
    conversionPct: salesQueueCount > 0 ? Math.round((matureCount / salesQueueCount) * 100) : 0,
    brochures: brochures,
    overallPct: overallPct,
    breakdown: role === 'Employee' ? [] : breakdown,
    recent: recent
  };
}

// ---------- My Entries ----------

// Returns entries for the scoped viewer (employee = own only, supervisor/RM = team/region)
// filtered to the given date range. Contacts appearing more than once in the
// full sheet are flagged isDuplicate=true so the UI can highlight them red.
function getMyEntries(crmId, params) {
  try {
    var profile = getProfile(crmId);
    if (!profile) return { error: 'Employee not found.' };
    var isAdm = isNationwideAdmin_(crmId);
    var role  = String(profile.role || 'Employee').trim();
    params = params || {};
    var search    = String(params.search    || '').toLowerCase().trim();
    var city      = String(params.city      || '');
    var fromDate  = String(params.fromDate  || '');
    var toDate    = String(params.toDate    || '');
    var empFilter = String(params.employeeCrmId || '');
    var typeFilter= String(params.type      || '');
    var soiFilter = String(params.soi       || '');
    var staFilter = String(params.status    || '');
    var dvrType   = String(params.dvrType   || '');   // 'Home DVR' | 'Corporate DVR' | ''
    var page      = Math.max(1, parseInt(params.page     || 1,10));
    var pageSize  = Math.min(100, Math.max(10, parseInt(params.pageSize || 50,10)));

    // ── scoped employees (NO designation exclusion — show all roles) ──
    var empRows  = getEmployeesData_();
    var scopedIds={}, empNameMap={}, empCityMap={}, empSet={};
    for(var ei=1;ei<empRows.length;ei++){
      var er=empRows[ei];
      var eCId=String(er[0]||'').trim(), eName=String(er[1]||'').trim(),
          eCity=String(er[3]||'').trim(), eRep=String(er[7]||'').trim(),
          eRegion=String(er[8]||'').trim();
      if(!eCId) continue;
      var ok=isAdm;
      if(!ok){
        if(role==='Regional Manager') ok=eRegion===profile.region;
        else if(role==='Supervisor')  ok=eCId===crmId||eRep===crmId;
        else                          ok=eCId===crmId;
      }
      if(ok){
        scopedIds[eCId.toLowerCase()]=true;
        empNameMap[eCId]=eName; empCityMap[eCId]=eCity;
        // Seed employee dropdown from ALL scoped employees, not just those with entries
        empSet[eCId]=eName;
      }
    }

    var sheet=getOrCreateSheet_(SHEET_NAME,COLUMNS);
    var data=sheet.getDataRange().getValues();
    var headers=data[0], col={};
    headers.forEach(function(h,i){col[String(h).trim()]=i;});

    // Always include predefined filter options regardless of data
    var CITIES_DEFAULT = ['Faisalabad','Peshawar','Gujranwala','Sargodha','Multan','Sialkot','Muzaffargarh'];
    var SOI_DEFAULT    = ['D2D','Reference','Social Media','Website','Walk-in','Existing Customer','Marketing Campaign','Other'];
    var STA_DEFAULT    = ['Mature','Pending due to customer','Follow-Up Required','Not Interested','Not in Coverage Area','Satisfied with current ISP'];
    var contactCount={}, citySet={}, typeSet={}, soiSet={}, staSet={};
    CITIES_DEFAULT.forEach(function(v){citySet[v]=true;});
    SOI_DEFAULT.forEach(function(v){soiSet[v]=true;});
    STA_DEFAULT.forEach(function(v){staSet[v]=true;});

    // Pass 1: duplicate detection + collect extra filter values from data
    for(var i=1;i<data.length;i++){
      var row=data[i];
      var rCId=String(row[col['CRM ID']]||'').trim();
      if(!scopedIds[rCId.toLowerCase()]) continue;
      var c=String(row[col['Customer Contact']]||'').trim();
      if(c) contactCount[c]=(contactCount[c]||0)+1;
      var rc=String(row[col['City']]||'').trim();            if(rc) citySet[rc]=true;
      var rt=String(row[col['Interaction Type']]||'').trim();if(rt) typeSet[rt]=true;
      var rs=String(row[col['SOI']]||'').trim();             if(rs) soiSet[rs]=true;
      var rst=String(row[col['Status']]||'').trim();         if(rst)staSet[rst]=true;
    }

    // Pass 2: apply filters and build result rows
    var allRows=[];
    for(var j=1;j<data.length;j++){
      var row2=data[j];
      var rCId2=String(row2[col['CRM ID']]||'').trim();
      if(!scopedIds[rCId2.toLowerCase()]) continue;
      var rDate=normalizeDateStr_(row2[col['Date']]);
      var rCity=String(row2[col['City']]||'').trim();
      var rType=String(row2[col['Interaction Type']]||'').trim();
      var rSoi =String(row2[col['SOI']]||'').trim();
      var rSta =String(row2[col['Status']]||'').trim();
      var rCon =String(row2[col['Customer Contact']]||'').trim();
      var rName=String(row2[col['Customer Name']]||'').trim();
      var rAddr=String(row2[col['Address']]||'').trim();
      var rCustType=String(row2[col['Customer Type']]||'').trim();
      var rEmp =empNameMap[rCId2]||String(row2[col['Employee Name']]||'').trim();
      if(empFilter && rCId2.toLowerCase()!==empFilter.toLowerCase()) continue;
      if(city      && rCity!==city)      continue;
      if(fromDate  && rDate<fromDate)    continue;
      if(toDate    && rDate>toDate)      continue;
      if(typeFilter&& rType!==typeFilter) continue;
      if(soiFilter && rSoi !==soiFilter) continue;
      if(staFilter && rSta !==staFilter) continue;
      // DVR Type filter
      if(dvrType==='Home DVR'      && rCustType.toLowerCase()!=='home')       continue;
      if(dvrType==='Corporate DVR' && rCustType.toLowerCase()==='home')        continue;
      if(search){
        var hay=(rName+' '+rCon+' '+rAddr+' '+rEmp+' '+rCity+' '+rSta+' '+rSoi+' '+rType+' '+rCustType).toLowerCase();
        if(hay.indexOf(search)<0) continue;
      }
      allRows.push({rowIndex:j, date:rDate, crmId:rCId2, empName:rEmp,
        time:String(row2[col['Time']]||'').trim(),
        sapNumber:String(row2[col['SAP Number']]||'').trim(),
        mobile:String(row2[col['Mobile Number']]||'').trim(),
        email:String(row2[col['Email']]||'').trim(),
        city:rCity, customerName:rName, contact:rCon, address:rAddr,
        customerType:rCustType, contactMode:rType,
        visitType:String(row2[col['Visit Type']]||'').trim(),
        customerEmail:String(row2[col['Customer Email']]||'').trim(),
        packageCategory:String(row2[col['Package Category']]||'').trim(),
        packageInterested:String(row2[col['Package Interested']]||'').trim(),
        mrc:Number(row2[col['MRC']]||0), soi:rSoi, status:rSta,
        userId:String(row2[col['User ID']]||'').trim(),
        selectedPackage:String(row2[col['Selected Package']]||'').trim(),
        brochures:Number(row2[col['Brochures Dropped']]||0),
        remarks:String(row2[col['Remarks']]||'').trim(),
        isDuplicate:(contactCount[rCon]||0)>1,
        submittedAt:String(row2[col['Submitted At']]||''),
        entryId:String(row2[col['Entry ID']]||'').trim(),
        // GPS fields — only populated for the nationwide admin (jahangir.ali)
        latitude:     isAdm ? String(row2[col['Latitude']]||'').trim()      : '',
        longitude:    isAdm ? String(row2[col['Longitude']]||'').trim()     : '',
        gpsAccuracy:  isAdm ? String(row2[col['GPS Accuracy']]||'').trim()  : '',
        gpsTimestamp: isAdm ? String(row2[col['GPS Timestamp']]||'').trim() : '',
        mapsUrl:      isAdm ? String(row2[col['Maps URL']]||'').trim()      : ''});
    }

    allRows.sort(function(a,b){
      var ta=new Date(a.submittedAt).getTime()||0;
      var tb=new Date(b.submittedAt).getTime()||0;
      if(tb!==ta) return tb-ta;                       // newest submission first
      return (b.date||'').localeCompare(a.date||'');  // fallback: latest date
    });

    var total=allRows.length, totalPages=Math.max(1,Math.ceil(total/pageSize));
    page=Math.min(page,totalPages);
    var entries=allRows.slice((page-1)*pageSize, page*pageSize);
    var empList=Object.keys(empSet).sort(function(a,b){return empSet[a].localeCompare(empSet[b]);})
      .map(function(id){return{crmId:id,name:empSet[id],city:empCityMap[id]||''};});

    return{ok:true, role:role, entries:entries,
      total:total, page:page, pageSize:pageSize, totalPages:totalPages,
      canEdit: true,
      canDelete: role==='Supervisor'||role==='Regional Manager'||isAdm,
      isSupervisor: role==='Supervisor', isAdmin:isAdm,
      filters:{cities:Object.keys(citySet).sort(), types:Object.keys(typeSet).sort(),
               sois:Object.keys(soiSet).sort(), statuses:Object.keys(staSet).sort(),
               employees:empList}};
  }catch(err){return{error:'getMyEntries: '+err.message};}
}

// Apply an edit directly (admin only — no approval needed)
function applyEditDirect(crmId, rowIndex, changes) {
  try{
    var profile=getProfile(crmId);
    if(!profile) return{error:'Not authenticated.'};
    if(!isNationwideAdmin_(crmId)) return{error:'Permission denied.'};
    var eSheet=getOrCreateSheet_(SHEET_NAME,COLUMNS);
    var eData=eSheet.getDataRange().getValues();
    var headers=eData[0], col={};
    headers.forEach(function(h,ix){col[String(h).trim()]=ix;});
    var map={customerName:'Customer Name',contact:'Customer Contact',address:'Address',
             city:'City',status:'Status',soi:'SOI',remarks:'Remarks',
             userId:'User ID',packageCategory:'Package Category',
             packageInterested:'Package Interested',selectedPackage:'Selected Package',mrc:'MRC'};
    var sheetRow=parseInt(rowIndex,10)+1;
    Object.keys(changes).forEach(function(k){
      if(map[k]!==undefined && col[map[k]]!==undefined){
        eSheet.getRange(sheetRow, col[map[k]]+1).setValue(changes[k]);
      }
    });
    return{ok:true};
  }catch(e){return{error:'applyEditDirect: '+e.message};}
}

function submitEditRequest(crmId, rowIndex, changes, originalData) {
  try{
    var sheet=getOrCreateSheet_('NSMS_EditRequests',
      ['RequestID','RowIndex','RequestedBy','RequestDate','Status',
       'OriginalData','NewData','ApprovedBy','ApprovalDate','Notes']);
    var id='EDIT_'+new Date().getTime();
    sheet.appendRow([id,rowIndex,crmId,
      Utilities.formatDate(new Date(),Session.getScriptTimeZone(),'yyyy-MM-dd HH:mm:ss'),
      'Pending',JSON.stringify(originalData),JSON.stringify(changes),'','','']);
    return{ok:true,requestId:id};
  }catch(e){return{error:'submitEditRequest: '+e.message};}
}

function deleteEntry(crmId, rowIndex) {
  try{
    var profile=getProfile(crmId);
    if(!profile) return{error:'Not authenticated.'};
    var isAdm=isNationwideAdmin_(crmId);
    var role=String(profile.role||'').trim();
    if(!isAdm&&role!=='Supervisor'&&role!=='Regional Manager')
      return{error:'Permission denied.'};
    var sheet=getOrCreateSheet_(SHEET_NAME,COLUMNS);
    sheet.deleteRow(rowIndex+1);
    return{ok:true};
  }catch(e){return{error:'deleteEntry: '+e.message};}
}

function getPendingApprovals(crmId) {
  try{
    var profile=getProfile(crmId);
    if(!profile) return{error:'Not authenticated.'};
    var isAdm=isNationwideAdmin_(crmId);
    var role=String(profile.role||'').trim();

    var sheet=SpreadsheetApp.getActiveSpreadsheet().getSheetByName('NSMS_EditRequests');
    if(!sheet) return{ok:true,pending:[]};
    var data=sheet.getDataRange().getValues();

    // Build the set of employees this approver can approve for
    var empRows=getEmployeesData_();
    var canApproveFor={};
    for(var ei=1;ei<empRows.length;ei++){
      var er=empRows[ei];
      var eCId=String(er[0]||'').trim(), eRep=String(er[7]||'').trim(), eRegion=String(er[8]||'').trim();
      if(!eCId) continue;
      var ok=isAdm;
      if(!ok){
        if(role==='Regional Manager') ok=eRegion===profile.region;
        else if(role==='Supervisor')  ok=eCId===crmId||eRep===crmId;
        else                          ok=false; // employees can't approve
      }
      if(ok) canApproveFor[eCId.toLowerCase()]=true;
    }

    var pending=[];
    for(var i=1;i<data.length;i++){
      if(String(data[i][4]).trim()!=='Pending') continue;
      var reqBy=String(data[i][2]||'').trim().toLowerCase();
      if(!isAdm && !canApproveFor[reqBy]) continue; // only show requests within scope
      pending.push({requestId:data[i][0],rowIndex:data[i][1],requestedBy:data[i][2],
        requestDate:data[i][3],original:data[i][5],changes:data[i][6]});
    }
    return{ok:true,pending:pending};
  }catch(e){return{error:'getPendingApprovals: '+e.message};}
}

// Approve a pending edit — applies the changes to the Entries sheet
function approveEditRequest(crmId, requestId) {
  try{
    var profile=getProfile(crmId);
    if(!profile) return{error:'Not authenticated.'};
    var isAdm=isNationwideAdmin_(crmId);
    var role=String(profile.role||'').trim();
    if(!isAdm && role!=='Supervisor' && role!=='Regional Manager')
      return{error:'Permission denied. Only supervisors or admin can approve.'};

    var reqSheet=SpreadsheetApp.getActiveSpreadsheet().getSheetByName('NSMS_EditRequests');
    if(!reqSheet) return{error:'No requests found.'};
    var data=reqSheet.getDataRange().getValues();
    for(var i=1;i<data.length;i++){
      if(String(data[i][0]).trim()!==String(requestId).trim()) continue;
      if(String(data[i][4]).trim()!=='Pending') return{error:'Request already processed.'};

      var rowIndex=parseInt(data[i][1],10);
      var changes=JSON.parse(data[i][6]||'{}');

      // Apply changes to the Entries sheet
      var eSheet=getOrCreateSheet_(SHEET_NAME,COLUMNS);
      var eData=eSheet.getDataRange().getValues();
      var headers=eData[0], col={};
      headers.forEach(function(h,ix){col[String(h).trim()]=ix;});
      // Map change keys → sheet columns
      var map={customerName:'Customer Name',contact:'Customer Contact',address:'Address',
               city:'City',status:'Status',soi:'SOI',remarks:'Remarks',
               userId:'User ID',packageCategory:'Package Category',
               packageInterested:'Package Interested',selectedPackage:'Selected Package',mrc:'MRC'};
      var sheetRow=rowIndex+1; // +1 for header (rowIndex is 1-based data index in getMyEntries)
      Object.keys(changes).forEach(function(k){
        if(map[k]!==undefined && col[map[k]]!==undefined){
          eSheet.getRange(sheetRow, col[map[k]]+1).setValue(changes[k]);
        }
      });

      // Mark request approved
      reqSheet.getRange(i+1, 8).setValue(profile.crmId);
      reqSheet.getRange(i+1, 9).setValue(Utilities.formatDate(new Date(),Session.getScriptTimeZone(),'yyyy-MM-dd HH:mm:ss'));
      reqSheet.getRange(i+1, 5).setValue('Approved');
      return{ok:true};
    }
    return{error:'Request not found.'};
  }catch(e){return{error:'approveEditRequest: '+e.message};}
}

// Reject a pending edit — original data stays unchanged
function rejectEditRequest(crmId, requestId, note) {
  try{
    var profile=getProfile(crmId);
    if(!profile) return{error:'Not authenticated.'};
    var isAdm=isNationwideAdmin_(crmId);
    var role=String(profile.role||'').trim();
    if(!isAdm && role!=='Supervisor' && role!=='Regional Manager')
      return{error:'Permission denied.'};
    var reqSheet=SpreadsheetApp.getActiveSpreadsheet().getSheetByName('NSMS_EditRequests');
    if(!reqSheet) return{error:'No requests found.'};
    var data=reqSheet.getDataRange().getValues();
    for(var i=1;i<data.length;i++){
      if(String(data[i][0]).trim()!==String(requestId).trim()) continue;
      if(String(data[i][4]).trim()!=='Pending') return{error:'Request already processed.'};
      reqSheet.getRange(i+1, 8).setValue(profile.crmId);
      reqSheet.getRange(i+1, 9).setValue(Utilities.formatDate(new Date(),Session.getScriptTimeZone(),'yyyy-MM-dd HH:mm:ss'));
      reqSheet.getRange(i+1, 5).setValue('Rejected');
      reqSheet.getRange(i+1, 10).setValue(String(note||''));
      return{ok:true};
    }
    return{error:'Request not found.'};
  }catch(e){return{error:'rejectEditRequest: '+e.message};}
}



// ---------- Export to Google Sheet ----------

// Creates a new Google Spreadsheet with the scoped/filtered data and returns
// its URL. The user can then download it as CSV or XLSX from Sheets.
// Access rules are the same as getMyEntries.
function exportToGoogleSheet(crmId, startDate, endDate) {
  try {
    var result = getMyEntries(crmId, startDate, endDate);
    if (!result || result.error) return { error: result.error || 'No data returned.' };

    var tz = Session.getScriptTimeZone();
    var label = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd HH:mm');
    var profile = getProfile(crmId);
    var role = effectiveRoleLabel_(profile);
    var sheetName = 'Nayatel DVR Export (' + role + ') ' + label;
    var ss = SpreadsheetApp.create(sheetName);
    var sheet = ss.getActiveSheet();
    sheet.setName('Entries');

    var headers = ['Date', 'Time', 'CRM ID', 'Employee Name', 'City',
                   'Customer Name', 'Contact', 'Customer Type', 'Interaction Type',
                   'Visit Type', 'Package Category', 'Package', 'MRC',
                   'Status', 'SOI', 'Remarks'];
    sheet.appendRow(headers);

    result.entries.forEach(function(e) {
      sheet.appendRow([
        e.date, e.time, e.crmId, e.empName, '',
        e.customerName, e.contact, e.customerType, e.contactMode,
        e.visitType, e.packageCategory, e.packageInterested, e.mrc,
        e.status, e.soi, e.remarks
      ]);
    });

    // Bold headers and auto-resize.
    sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
    sheet.autoResizeColumns(1, headers.length);

    // Make accessible to the script owner.
    ss.addEditor(Session.getEffectiveUser().getEmail());

    return { url: ss.getUrl(), count: result.entries.length, name: sheetName };
  } catch (err) {
    return { error: 'exportToGoogleSheet failed: ' + err.message };
  }
}

// ---------- Bulk upload (jahangir.ali only) ----------

// Expected: array of row objects matching the upload CSV column names.
// Upload CSV headers (row 1 must match):
// Date | Time | CRM ID | Employee Name | SAP Number | City | Mobile Number | Email |
// Customer Type | Interaction Type | Visit Type | Customer Name | Customer Contact |
// Customer Email | Address | Package Category | Package Interested | MRC | SOI |
// Status | User ID | Selected Package | Brochures Dropped | Remarks
function bulkUploadEntries(crmId, rows) {
  if (!isNationwideAdmin_(crmId)) {
    return { error: 'Unauthorized. Only the nationwide admin can upload bulk data.' };
  }
  if (!rows || !rows.length) return { error: 'No rows provided.' };

  try {
    var sheet = getOrCreateSheet_(SHEET_NAME, COLUMNS);
    var count = 0;
    var errors = [];

    rows.forEach(function(row, idx) {
      try {
        sheet.appendRow([
          new Date(),                          // Submitted At (auto)
          row['Date'] || '',
          row['Time'] || '',
          row['CRM ID'] || '',
          row['Employee Name'] || '',
          row['SAP Number'] || '',
          row['City'] || '',
          row['Mobile Number'] || '',
          row['Email'] || '',
          row['Customer Type'] || '',
          row['Interaction Type'] || '',
          row['Visit Type'] || '',
          row['Customer Name'] || '',
          row['Customer Contact'] || '',
          row['Customer Email'] || '',
          row['Address'] || '',
          row['Package Category'] || '',
          row['Package Interested'] || '',
          Number(row['MRC']) || 0,
          row['SOI'] || '',
          row['Status'] || '',
          row['User ID'] || '',
          row['Selected Package'] || '',
          Number(row['Brochures Dropped']) || 0,
          row['Remarks'] || ''
        ]);
        count++;
      } catch (rowErr) {
        errors.push('Row ' + (idx + 2) + ': ' + rowErr.message);
      }
    });

    return { ok: true, count: count, errors: errors };
  } catch (err) {
    return { error: 'bulkUploadEntries failed: ' + err.message };
  }
}

// ===== EXECUTIVE DASHBOARD (v3) =====
// Designations excluded from all reports and dropdowns
var EXCL_DESIG = [
  'front desk executive','key account manager','deputy manager',
  'manager','senior manager','sales performance manager','general manager'
];

// Working days (Mon–Sat) for a given period; used to scale targets
function getWorkingDaysExec_(fromDate, toDate, month) {
  try {
    var tz = Session.getScriptTimeZone();
    var start, end;
    if (fromDate && toDate) {
      start = new Date(fromDate + 'T00:00:00');
      end   = new Date(toDate   + 'T00:00:00');
    } else if (month && month !== 'All') {
      var yr = new Date().getFullYear();
      var m  = parseInt(month, 10) - 1;
      start = new Date(yr, m, 1);
      end   = new Date(yr, m + 1, 0);
    } else {
      // Default: current month up to today
      var now = new Date();
      start = new Date(now.getFullYear(), now.getMonth(), 1);
      end   = now;
    }
    if (isNaN(start.getTime()) || isNaN(end.getTime()) || end < start) return 1;
    var days = 0, cur = new Date(start);
    while (cur <= end) {
      var dow = cur.getDay();
      if (dow !== 0) days++;   // exclude Sundays only (Mon–Sat working)
      cur.setDate(cur.getDate() + 1);
    }
    return Math.max(1, days);
  } catch (e) { return 1; }
}

function getExecutiveDashboard(crmId, params) {
  try {
    var profile = getProfile(crmId);
    if (!profile) return { error: 'Profile not found.' };
    var role = String(profile.role || 'Employee').trim();
    var isAdm = isNationwideAdmin_(crmId);
    params = params || {};
    var month      = String(params.month      || 'All');
    var fromDate   = String(params.fromDate   || '');
    var toDate     = String(params.toDate     || '');
    var cityFilter = String(params.city       || 'All');
    var empFilter  = String(params.employeeCrmId || 'All');

    // ── scoped employees ──
    // Pass 1: all employees accessible by role → used to populate dropdowns
    var empRows  = getEmployeesData_();
    var allScopedEmps = {};
    for (var i=1;i<empRows.length;i++){
      var er=empRows[i];
      var eCId=String(er[0]||'').trim(), eName=String(er[1]||'').trim(),
          eCity=String(er[3]||'').trim(), eRole=String(er[6]||'').trim()||'Employee',
          eRep=String(er[7]||'').trim(), eRegion=String(er[8]||'').trim(),
          eDesig=String(er[10]||'').trim().toLowerCase();
          eDesigRaw=String(er[10]||'').trim();
      if(!eCId) continue;
      // (designation exclusion removed — all employees shown everywhere)
      var ok=isAdm;
      if(!ok){
        if(role==='Regional Manager') ok=eRegion===profile.region;
        else if(role==='Supervisor')  ok=eCId===crmId||eRep===crmId;
        else                          ok=eCId===crmId;
      }
      if(ok) allScopedEmps[eCId]={name:eName,city:eCity,role:eRole,designation:eDesigRaw};
    }
    // Dropdown lists always show every accessible city / employee
    var citySet={},cityList=[],empList=[];
    Object.keys(allScopedEmps).forEach(function(id){
      var e=allScopedEmps[id];
      empList.push({crmId:id,name:e.name,city:e.city,role:e.role});
      if(e.city&&!citySet[e.city]){citySet[e.city]=true;cityList.push(e.city);}
    });
    cityList.sort();
    empList.sort(function(a,b){return a.name.localeCompare(b.name);});
    // Pass 2: apply city / employee filter for data only
    var scopedEmps = {};
    Object.keys(allScopedEmps).forEach(function(id){
      if(cityFilter!=='All' && allScopedEmps[id].city!==cityFilter) return;
      if(empFilter!=='All'  && id!==empFilter) return;
      scopedEmps[id]=allScopedEmps[id];
    });

    // ── load entries ──
    var sheet=getOrCreateSheet_(SHEET_NAME,COLUMNS);
    var data=sheet.getDataRange().getValues();
    var C={DATE:1,CRMID:3,EMPNAME:4,CITY:6,CONTACT:13,BROCHURES:23,STATUS:20,SOI:19};
    var allRows=[], rows=[];
    for(var r=1;r<data.length;r++){
      var row=data[r];
      var rCId=String(row[C.CRMID]||'').trim();
      if(!scopedEmps[rCId]) continue;
      var rCity=String(row[C.CITY]||'').trim();
      if(cityFilter!=='All'&&rCity!==cityFilter) continue;
      if(empFilter!=='All'&&rCId!==empFilter)   continue;
      var rDate=normalizeDateStr_(row[C.DATE]);
      var entry={crmId:rCId,empName:String(row[C.EMPNAME]||'').trim(),city:rCity,
                 date:rDate,contact:String(row[C.CONTACT]||'').trim(),
                 brochures:Number(row[C.BROCHURES])||0,
                 status:String(row[C.STATUS]||'').trim(),
                 soi:String(row[C.SOI]||'').trim()};
      allRows.push(entry);
      if(fromDate&&rDate<fromDate) continue;
      if(toDate  &&rDate>toDate)   continue;
      if(month!=='All'){var rm=rDate?rDate.substring(5,7):'';if(rm!==month) continue;}
      rows.push(entry);
    }

    // ── effective employees (scopedEmps is already city+emp filtered) ──
    var effIds=Object.keys(scopedEmps);
    var nEmps=Math.max(1,effIds.length);
    function pct(a,t){return t>0?Math.min(100,Math.round(a/t*100)):0;}

    // ── date helpers ──
    var tz=Session.getScriptTimeZone();
    var nowD=new Date();
    var todayStr=Utilities.formatDate(nowD,tz,'yyyy-MM-dd');
    var dow=nowD.getDay(), dBack=dow===0?6:dow-1;
    var wkD=new Date(nowD); wkD.setDate(nowD.getDate()-dBack);
    var weekStartStr=Utilities.formatDate(wkD,tz,'yyyy-MM-dd');
    var monthStartStr=Utilities.formatDate(nowD,tz,'yyyy-MM')+'-01';

    // ── period KPIs ──
    function calcPKpi(arr,dvrT,sqT,d2dT){
      var dvr=arr.length,sqM={},d2d=0;
      arr.forEach(function(r){if(r.contact)sqM[r.contact]=true;d2d+=r.brochures;});
      var sq=Object.keys(sqM).length;
      return{dvr:{actual:dvr,target:dvrT,pct:pct(dvr,dvrT)},
             sq:{actual:sq,target:sqT,pct:pct(sq,sqT)},
             d2d:{actual:d2d,target:d2dT,pct:pct(d2d,d2dT)}};
    }
    var dRows=allRows.filter(function(r){return r.date===todayStr;});
    var wRows=allRows.filter(function(r){return r.date>=weekStartStr&&r.date<=todayStr;});
    var mRows=allRows.filter(function(r){return r.date>=monthStartStr&&r.date<=todayStr;});
    var kpi={
      daily:  calcPKpi(dRows, DVR_TARGET*nEmps,  SQ_TARGET*nEmps,  D2D_DAILY_TARGET*nEmps),
      weekly: calcPKpi(wRows, DVR_WEEKLY*nEmps,  SQ_WEEKLY*nEmps,  D2D_WEEKLY_TARGET*nEmps),
      monthly:calcPKpi(mRows, DVR_MONTHLY*nEmps, SQ_MONTHLY*nEmps, D2D_MONTHLY_TARGET*nEmps)
    };
    var dvr=rows.length,sqMap={},d2d=0;
    rows.forEach(function(r){if(r.contact)sqMap[r.contact]=true;d2d+=r.brochures;});
    var sq=Object.keys(sqMap).length;
    kpi.totals={dvr:dvr,sq:sq,d2d:d2d};

    // ── today per-employee (for current-day sub-filter) ──
    var todayEmpMap={};
    effIds.forEach(function(id){
      todayEmpMap[id]={crmId:id,name:scopedEmps[id].name,city:scopedEmps[id].city,dvr:0,sqC:{},d2d:0};
    });
    dRows.forEach(function(r){
      if(!todayEmpMap[r.crmId]) return;
      todayEmpMap[r.crmId].dvr++;
      if(r.contact) todayEmpMap[r.crmId].sqC[r.contact]=true;
      todayEmpMap[r.crmId].d2d+=r.brochures;
    });
    var todayData=Object.keys(todayEmpMap).map(function(id){
      var e=todayEmpMap[id];
      return{crmId:id,name:e.name,city:e.city,dvr:e.dvr,sq:Object.keys(e.sqC).length,d2d:e.d2d};
    });

    // ── monthly trend ──
    var MN=['','JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
    var mMap={};
    rows.forEach(function(r){
      if(!r.date)return; var k=r.date.substring(0,7);
      if(!mMap[k])mMap[k]={dvr:0,sqC:{},d2d:0};
      mMap[k].dvr++;if(r.contact)mMap[k].sqC[r.contact]=true;mMap[k].d2d+=r.brochures;
    });
    var monthlyTrend=Object.keys(mMap).sort().map(function(k){
      var md=mMap[k],p=k.split('-');
      return{label:MN[parseInt(p[1])]+"'"+p[0].substring(2),dvr:md.dvr,sq:Object.keys(md.sqC).length,d2d:md.d2d};
    });

    // ── city-wise data ──
    var cMap={};
    rows.forEach(function(r){
      var c=r.city;if(!cMap[c])cMap[c]={dvr:0,sqC:{},d2d:0,eids:{}};
      cMap[c].dvr++;if(r.contact)cMap[c].sqC[r.contact]=true;
      cMap[c].d2d+=r.brochures;cMap[c].eids[r.crmId]=true;
    });
    var wDays=getWorkingDaysExec_(fromDate,toDate,month);
    var cityData=Object.keys(cMap).sort().map(function(c){
      var cd=cMap[c],cn=Object.keys(cd.eids).length;
      var cDT=DVR_TARGET*wDays*cn,cST=SQ_TARGET*wDays*cn,cD2T=D2D_DAILY_TARGET*wDays*cn;
      var csq=Object.keys(cd.sqC).length;
      return{city:c,dvr:cd.dvr,dvrTarget:cDT,dvrPct:pct(cd.dvr,cDT),
             sq:csq,sqTarget:cST,sqPct:pct(csq,cST),
             d2d:cd.d2d,d2dTarget:cD2T,d2dPct:pct(cd.d2d,cD2T)};
    });

    // ── city-wise matured signups + employee breakdown ──
    var maturedMap={},maturedEmpCity={};
    rows.forEach(function(r){
      if(!r.status.toLowerCase().includes('matur')) return;
      maturedMap[r.city]=(maturedMap[r.city]||0)+1;
      if(!maturedEmpCity[r.crmId]) maturedEmpCity[r.crmId]={};
      maturedEmpCity[r.crmId][r.city]=(maturedEmpCity[r.crmId][r.city]||0)+1;
    });
    var cityMatured=Object.keys(maturedMap).sort().map(function(c){return{city:c,count:maturedMap[c]};});

    // ── SOI distribution ──
    var soiMap={},soiTotal=rows.length;
    rows.forEach(function(r){var s=r.soi||'Unknown';soiMap[s]=(soiMap[s]||0)+1;});
    var soiDistribution=Object.keys(soiMap).sort(function(a,b){return soiMap[b]-soiMap[a];})
      .map(function(s){return{soi:s,count:soiMap[s],pct:soiTotal>0?Math.round(soiMap[s]/soiTotal*100):0};});

    // ── performers ──
    var eMap={};
    effIds.forEach(function(id){
      eMap[id]={crmId:id,name:scopedEmps[id].name,city:scopedEmps[id].city,role:scopedEmps[id].role,designation:scopedEmps[id].designation||'',dvr:0,sqC:{},d2d:0};
    });
    rows.forEach(function(r){
      if(!eMap[r.crmId])return;
      eMap[r.crmId].dvr++;if(r.contact)eMap[r.crmId].sqC[r.contact]=true;eMap[r.crmId].d2d+=r.brochures;
    });
    var eDT=DVR_TARGET*wDays,eST=SQ_TARGET*wDays,eD2T=D2D_DAILY_TARGET*wDays;
    var performers=Object.keys(eMap).map(function(id){
      var e=eMap[id],esq=Object.keys(e.sqC).length;
      var dp=pct(e.dvr,eDT),sp=pct(esq,eST),d2dp=pct(e.d2d,eD2T);
      return{crmId:e.crmId,name:e.name,city:e.city,role:e.role,designation:e.designation||'',
             dvr:e.dvr,dvrTarget:eDT,dvrPct:dp,
             sq:esq,sqTarget:eST,sqPct:sp,
             d2d:e.d2d,d2dTarget:eD2T,d2dPct:d2dp,
             overallPct:Math.round((dp+sp+d2dp)/3)};
    });
    performers.sort(function(a,b){return b.overallPct-a.overallPct;});

    // ── alerts ──
    var alerts=[];
    performers.forEach(function(p){
      if(p.dvr===0)       alerts.push({type:'critical',icon:'error',msg:p.name+' has zero DVR entries in selected period.'});
      else if(p.dvrPct<50)alerts.push({type:'critical',icon:'warning',msg:p.name+' achieved only '+p.dvrPct+'% of DVR target.'});
      if(p.sqPct<40)      alerts.push({type:'warning',icon:'trending_down',msg:p.name+' is below 40% Sales Queue achievement ('+p.sqPct+'%).'});
      if(p.d2dPct<40&&p.d2d>0) alerts.push({type:'warning',icon:'home',msg:p.name+' D2D achievement is only '+p.d2dPct+'%.'});
    });
    cityData.forEach(function(c){
      if(c.dvr===0)       alerts.push({type:'critical',icon:'location_off',msg:c.city+' has zero entries in selected period.'});
      else if(c.dvrPct<50)alerts.push({type:'warning',icon:'location_city',msg:c.city+' DVR achievement is '+c.dvrPct+'% — below 50%.'});
    });
    if(pct(kpi.daily.dvr.actual,kpi.daily.dvr.target)>=100) alerts.push({type:'good',icon:'check_circle',msg:"Today's DVR target fully achieved!"});
    if(pct(kpi.monthly.dvr.actual,kpi.monthly.dvr.target)>=100) alerts.push({type:'good',icon:'check_circle',msg:'Monthly DVR target fully achieved!'});
    var to={'critical':0,'warning':1,'good':2};
    alerts.sort(function(a,b){return to[a.type]-to[b.type];});

    return{ok:true,cities:cityList,employees:empList,
      kpi:kpi, targets:{dvr:DVR_TARGET,sq:SQ_TARGET,d2d:D2D_DAILY_TARGET},
      monthlyTrend:monthlyTrend,cityData:cityData,
      cityMatured:cityMatured,maturedEmpCity:maturedEmpCity,
      soiDistribution:soiDistribution,
      topPerformers:performers.slice(0,3),
      lowPerformers:performers.slice().sort(function(a,b){return a.overallPct-b.overallPct;}).slice(0,3),
      allPerformers:performers,
      todayData:todayData,
      alerts:alerts.slice(0,12)};
  }catch(e){return{error:'getExecutiveDashboard: '+e.message};}
}

// ===== CITY REPORT =====
function getCityReport(crmId, params) {
  try {
    var profile = getProfile(crmId);
    if (!profile) return { error: 'Profile not found.' };
    var role  = String(profile.role || 'Employee').trim();
    var isAdm = isNationwideAdmin_(crmId);
    params = params || {};
    var city      = String(params.city          || 'All');
    var empFilter = String(params.employeeCrmId || 'All');   // ← employee filter
    var month = parseInt(params.month || (new Date().getMonth()+1), 10);
    var year  = parseInt(params.year  || new Date().getFullYear(), 10);

    // Pass 1 — all role-accessible employees (for dropdown lists)
    var empRows  = getEmployeesData_();
    var allScopedEmps = {};
    for (var i=1;i<empRows.length;i++){
      var er=empRows[i];
      var eCId=String(er[0]||'').trim(), eName=String(er[1]||'').trim(),
          eCity=String(er[3]||'').trim(), eRole=String(er[6]||'').trim()||'Employee',
          eRep=String(er[7]||'').trim(), eRegion=String(er[8]||'').trim(),
          eDesig=String(er[10]||'').trim().toLowerCase();
          eDesigRaw=String(er[10]||'').trim();
      if(!eCId) continue;
      // (designation exclusion removed — all employees shown everywhere)
      var ok=isAdm;
      if(!ok){
        if(role==='Regional Manager') ok=eRegion===profile.region;
        else if(role==='Supervisor')  ok=eCId===crmId||eRep===crmId;
        else                          ok=eCId===crmId;
      }
      if(ok) allScopedEmps[eCId]={name:eName,city:eCity,role:eRole,designation:eDesigRaw};
    }
    // Pass 2 — apply BOTH city and employee filters for data
    // (role exclusion removed — all employees shown in reports)
    var scopedEmps = {};
    Object.keys(allScopedEmps).forEach(function(id){
      if(city!=='All'      && allScopedEmps[id].city!==city) return;
      if(empFilter!=='All' && id!==empFilter)                return;
      scopedEmps[id]=allScopedEmps[id];
    });
    // City dropdown list — always all accessible cities
    var citySet={},cityList=[];
    Object.keys(allScopedEmps).forEach(function(id){
      var c=allScopedEmps[id].city;
      if(c&&!citySet[c]){citySet[c]=true;cityList.push(c);}
    });
    cityList.sort();

    // ── Period: 26th of prev month → 25th of current month ──
    var prevMonth = month===1?12:month-1;
    var prevYear  = month===1?year-1:year;
    function pad(n){ return n<10?'0'+n:String(n); }
    var periodStart = prevYear+'-'+pad(prevMonth)+'-26';
    var periodEnd   = year   +'-'+pad(month)     +'-25';

    // Build ordered list of dates in the period → sequential index
    var tz = Session.getScriptTimeZone();
    var days=[], dayNames={}, isWeekend={}, dayLabels={}, dateToIdx={};
    var DAY_NAMES=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    var cur = new Date(prevYear, prevMonth-1, 26);
    var endD = new Date(year, month-1, 25);
    var idx = 1;
    while(cur<=endD){
      var ds = Utilities.formatDate(cur, tz, 'yyyy-MM-dd');
      days.push(idx);
      dayNames[idx]  = DAY_NAMES[cur.getDay()];
      isWeekend[idx] = (cur.getDay()===0||cur.getDay()===6);
      dayLabels[idx] = String(cur.getDate());   // display: 26,27…1,2…25
      dateToIdx[ds]  = idx;
      idx++; cur.setDate(cur.getDate()+1);
    }

    // ── Init grids using sequential index ──
    var ids=Object.keys(scopedEmps);
    var dvrG={},sqG={},d2dG={},sqHistC={},sqMonC={},sqBF={};
    ids.forEach(function(id){
      dvrG[id]={}; sqG[id]={}; d2dG[id]={};
      sqHistC[id]={}; sqMonC[id]={}; sqBF[id]=0;
      days.forEach(function(i){ dvrG[id][i]=0; sqG[id][i]=0; d2dG[id][i]=0; });
    });

    // ── Scan entries ──
    var sheet=getOrCreateSheet_(SHEET_NAME,COLUMNS);
    var data=sheet.getDataRange().getValues();
    var C={DATE:1,CRMID:3,CONTACT:13,BROCHURES:23};
    for(var r=1;r<data.length;r++){
      var row=data[r];
      var rId=String(row[C.CRMID]||'').trim();
      if(!scopedEmps[rId]) continue;
      var rDate=normalizeDateStr_(row[C.DATE]);
      if(!rDate) continue;
      var rContact=String(row[C.CONTACT]||'').trim();
      var rBroch=Number(row[C.BROCHURES])||0;
      if(rDate<periodStart){
        if(rContact) sqHistC[rId][rContact]=true;
        continue;
      }
      if(rDate>periodEnd) continue;
      var di=dateToIdx[rDate];
      if(!di) continue;
      dvrG[rId][di]++;
      d2dG[rId][di]+=rBroch;
      if(rContact&&!sqHistC[rId][rContact]&&!sqMonC[rId][rContact]){
        sqMonC[rId][rContact]=di; sqG[rId][di]++;
      }
    }
    ids.forEach(function(id){sqBF[id]=Object.keys(sqHistC[id]).length;});

    // ── Totals per employee ──
    var empTotals={};
    ids.forEach(function(id){
      var dvr=0,sq=0,d2d=0,wk=0;
      days.forEach(function(i){
        dvr+=dvrG[id][i]; sq+=sqG[id][i]; d2d+=d2dG[id][i];
        if(dvrG[id][i]>0||sqG[id][i]>0) wk++;
      });
      empTotals[id]={dvr:dvr,sq:sq,sqBF:sqBF[id],
        sqGrandTotal:sqBF[id]+Object.keys(sqMonC[id]).length,
        d2d:d2d,workDays:wk,
        avgDvr:wk>0?Math.round(dvr/wk*100)/100:0,
        avgSq:wk>0?Math.round(sq/wk*10)/10:0};
    });

    var MNAMES=['','January','February','March','April','May','June',
                'July','August','September','October','November','December'];
    var SMN=['','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    var periodLabel='26 '+SMN[prevMonth]+' '+prevYear+' – 25 '+SMN[month]+' '+year;

    var allEmpList=Object.keys(allScopedEmps).map(function(id){
      return{crmId:id,name:allScopedEmps[id].name,city:allScopedEmps[id].city,role:allScopedEmps[id].role,designation:allScopedEmps[id].designation||''};
    }).sort(function(a,b){return a.name.localeCompare(b.name);});

    return{ok:true, cityList:cityList, employees:allEmpList,
      reportEmployees:ids.map(function(id){
        return{crmId:id,name:scopedEmps[id].name,city:scopedEmps[id].city,role:scopedEmps[id].role,designation:scopedEmps[id].designation||''};
      }).sort(function(a,b){return a.name.localeCompare(b.name);}),
      days:days, dayNames:dayNames, isWeekend:isWeekend, dayLabels:dayLabels,
      dvrGrid:dvrG, sqGrid:sqG, d2dGrid:d2dG, sqBF:sqBF,
      empTotals:empTotals, month:month, year:year,
      monthLabel:MNAMES[month], periodLabel:periodLabel};
  }catch(e){return{error:'getCityReport: '+e.message};}
}

// ── Fast filter-options loader ────────────────────────
function getFilterLists(crmId) {
  try {
    var profile = getProfile(crmId);
    if (!profile) return { error: 'Profile not found.' };
    var role = String(profile.role || 'Employee').trim();
    var isAdm = isNationwideAdmin_(crmId);

    var empRows  = getEmployeesData_();
    var citySet = {}, cityList = [], empList = [];

    for (var i = 1; i < empRows.length; i++) {
      var er = empRows[i];
      var eCId    = String(er[0]||'').trim();
      var eName   = String(er[1]||'').trim();
      var eCity   = String(er[3]||'').trim();
      var eRole   = String(er[6]||'').trim() || 'Employee';
      var eRep    = String(er[7]||'').trim();
      var eRegion = String(er[8]||'').trim();
      if (!eCId) continue;

      var ok = isAdm;
      if (!ok) {
        if (role === 'Regional Manager') ok = eRegion === profile.region;
        else if (role === 'Supervisor')  ok = eCId === crmId || eRep === crmId;
        else                             ok = eCId === crmId;
      }
      if (!ok) continue;

      empList.push({ crmId: eCId, name: eName, city: eCity, role: eRole });
      if (eCity && !citySet[eCity]) { citySet[eCity] = true; cityList.push(eCity); }
    }

    cityList.sort();
    empList.sort(function(a,b){ return a.name.localeCompare(b.name); });
    return { ok: true, cities: cityList, employees: empList };
  } catch(e) {
    return { error: 'getFilterLists: ' + e.message };
  }
}



