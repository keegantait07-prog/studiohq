#include "LibraryDb.h"
#include <sqlite3.h>

using namespace juce;

File LibraryDb::defaultDbFile()
{
    // JUCE's userApplicationDataDirectory is ~/Library on macOS, so spell the path out
    return File::getSpecialLocation (File::userHomeDirectory).getChildFile ("Library/Application Support/Studio HQ/studio-hq.db");
}

namespace
{
struct Stmt
{
    sqlite3_stmt* s = nullptr;
    Stmt (sqlite3* db, const char* sql) { if (sqlite3_prepare_v2 (db, sql, -1, &s, nullptr) != SQLITE_OK) s = nullptr; }
    ~Stmt() { if (s) sqlite3_finalize (s); }
    bool step() { return s != nullptr && sqlite3_step (s) == SQLITE_ROW; }
    String text (int c) { auto* t = sqlite3_column_text (s, c); return t ? String::fromUTF8 ((const char*) t) : String(); }
    int integer (int c) { return sqlite3_column_int (s, c); }
    double real (int c) { return sqlite3_column_double (s, c); }
    explicit operator bool() const { return s != nullptr; }
};
}

bool LibraryDb::load (const File& dbFile, String& error)
{
    sounds.clear();
    projects.clear();
    kinds.clear();
    indexById.clear();

    if (! dbFile.existsAsFile()) { error = "Studio HQ's library wasn't found. Open the Studio HQ app once and let it scan."; return false; }

    sqlite3* db = nullptr;
    // A WAL-mode database can't be opened with the read-only flag when the app is closed (the helper files don't
    // exist then), so open it normally and make the connection unable to write. The app may be running at the same time.
    if (sqlite3_open_v2 (dbFile.getFullPathName().toRawUTF8(), &db, SQLITE_OPEN_READWRITE, nullptr) != SQLITE_OK)
    {
        if (db) sqlite3_close (db);
        db = nullptr;
        // the file may be read-only on disk: read it as it is
        const auto uri = "file:" + dbFile.getFullPathName().replace ("?", "%3f").replace ("#", "%23") + "?immutable=1";
        if (sqlite3_open_v2 (uri.toRawUTF8(), &db, SQLITE_OPEN_READONLY | SQLITE_OPEN_URI, nullptr) != SQLITE_OK)
        {
            error = "Couldn't open the Studio HQ library: " + String (db ? sqlite3_errmsg (db) : "unknown error");
            if (db) sqlite3_close (db);
            return false;
        }
    }
    sqlite3_busy_timeout (db, 3000);
    sqlite3_exec (db, "PRAGMA query_only = ON", nullptr, nullptr, nullptr);

    std::map<int, String> tags;
    if (Stmt q { db, "SELECT sound_id, group_concat(value, ' ') FROM sound_tags GROUP BY sound_id" })
        while (q.step()) tags[q.integer (0)] = q.text (1);

    std::map<int, int> notes;
    if (Stmt q { db, "SELECT sound_id, notes FROM flp_midis WHERE sound_id IS NOT NULL" })
        while (q.step()) notes[q.integer (0)] = q.integer (1);

    // the library folders, to show each sound's folder relative to its pack root
    // the app only stores folders you changed, so also know the defaults and the MIDI it makes from your projects
    const auto home = File::getSpecialLocation (File::userHomeDirectory);
    StringArray roots { home.getChildFile ("Desktop/!DRUM KITS").getFullPathName(), home.getChildFile ("Library/Application Support/Studio HQ/FL project MIDI").getFullPathName() };
    if (Stmt q { db, "SELECT value FROM settings WHERE key='app'" })
        if (q.step())
        {
            auto v = JSON::parse (q.text (0));
            if (auto* arr = v.getProperty ("soundFolders", {}).getArray()) for (auto& r : *arr) roots.add (r.toString());
        }

    if (Stmt q { db, "SELECT id, path, name, ext, kind, duration, bpm, key, favorite FROM sounds WHERE missing=0 ORDER BY name COLLATE NOCASE" })
    {
        while (q.step())
        {
            SoundItem s;
            s.id = q.integer (0);
            s.file = File (q.text (1));
            s.name = q.text (2);
            s.ext = q.text (3);
            s.kind = q.text (4);
            s.duration = q.real (5);
            s.bpm = q.real (6);
            s.key = q.text (7);
            s.favorite = q.integer (8) != 0;
            if (auto it = tags.find (s.id); it != tags.end()) s.tags = it->second;
            if (auto it = notes.find (s.id); it != notes.end()) s.notes = it->second;
            auto dir = s.file.getParentDirectory().getFullPathName();
            for (auto& r : roots) if (dir.startsWith (r)) { dir = dir.substring (r.length()).trimCharactersAtStart ("/"); break; }
            s.dirRel = dir;
            s.hay = (s.name + " " + dir + " " + s.tags + " " + s.kind).toLowerCase();
            indexById.set (s.id, sounds.size());
            if (! kinds.contains (s.kind)) kinds.add (s.kind);
            sounds.add (std::move (s));
        }
    }
    else { error = "Couldn't read the Studio HQ library: " + String (sqlite3_errmsg (db)); sqlite3_close (db); return false; }
    if (sounds.isEmpty()) { error = "The Studio HQ library has no sounds yet. Open the app and let it scan."; sqlite3_close (db); return false; }

    std::map<int, ProjectItem> byId;
    if (Stmt q { db, "SELECT id, name FROM flp_projects ORDER BY mtime DESC" })
        while (q.step()) { ProjectItem p; p.id = q.integer (0); p.name = q.text (1); byId[p.id] = p; }
    std::vector<int> order;
    if (Stmt q { db, "SELECT id FROM flp_projects ORDER BY mtime DESC" }) while (q.step()) order.push_back (q.integer (0));
    auto add = [&] (const char* sql, bool midi)
    {
        if (Stmt q { db, sql })
            while (q.step())
                if (auto it = byId.find (q.integer (0)); it != byId.end() && indexById.contains (q.integer (1)))
                { it->second.soundIds.addIfNotAlreadyThere (q.integer (1)); (midi ? it->second.midis : it->second.samples)++; }
    };
    add ("SELECT project_id, sound_id FROM flp_samples WHERE sound_id IS NOT NULL", false);
    add ("SELECT project_id, sound_id FROM flp_midis WHERE sound_id IS NOT NULL", true);
    for (int id : order) if (byId[id].soundIds.size() > 0) projects.add (byId[id]);

    sqlite3_close (db);
    kinds.sort (true);
    return true;
}
