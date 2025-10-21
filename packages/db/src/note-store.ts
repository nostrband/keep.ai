import { generateId } from 'ai';
import { CRSqliteDB } from './database';
import debug from "debug";

const debugNoteStore = debug("db:note-store");

export interface Note {
  id: string;
  user_id: string;
  title: string;
  content: string;
  tags: string[];
  priority: 'low' | 'medium' | 'high';
  created: string;
  updated: string;
}

export interface NoteRow {
  id: string;
  user_id: string;
  title: string;
  content: string;
  tags: string; // JSON string
  priority: 'low' | 'medium' | 'high';
  created: string;
  updated: string;
}

export interface NoteListItem {
  id: string;
  user_id: string;
  title: string;
  tags: string[];
  priority: 'low' | 'medium' | 'high';
  created: string;
  updated: string;
  snippet?: string; // For search results
}

function rowToNote(row: NoteRow): Note {
  return {
    ...row,
    tags: JSON.parse(row.tags),
  };
}

function rowToNoteListItem(row: NoteRow, snippet?: string): NoteListItem {
  return {
    id: row.id,
    user_id: row.user_id,
    title: row.title,
    tags: JSON.parse(row.tags),
    priority: row.priority,
    created: row.created,
    updated: row.updated,
    snippet,
  };
}

export class NoteStore {
  private db: CRSqliteDB;
  private user_id: string;

  constructor(db: CRSqliteDB, user_id: string) {
    this.db = db;
    this.user_id = user_id;
  }

  async validateCreateNote(
    title: string,
    content: string,
    tags: string[] = []
  ): Promise<void> {
    // Check if user already has 500 notes
    const results = await this.db.db.execO<{ count: number }>('SELECT COUNT(*) as count FROM notes WHERE user_id = ?', [this.user_id]);
    const count = results?.[0]?.count || 0;
    
    if (count >= 500) {
      throw new Error('Maximum number of notes (500) reached');
    }
    
    // Check title + content + tags size (50KB limit)
    const tagsJson = JSON.stringify(tags);
    const totalSize = new TextEncoder().encode(title + content + tagsJson).length;
    if (totalSize > 50 * 1024) {
      throw new Error('Note size exceeds 50KB limit');
    }
  }

  async createNote(
    title: string,
    content: string,
    tags: string[] = [],
    priority: 'low' | 'medium' | 'high' = 'low',
    id?: string
  ): Promise<Note> {
    const noteId = id || generateId();
    const now = new Date().toISOString();
    const tagsJson = JSON.stringify(tags);
    
    await this.db.db.exec(`INSERT INTO notes (id, user_id, title, content, tags, priority, created, updated)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [noteId, this.user_id, title, content, tagsJson, priority, now, now]);
    
    return {
      id: noteId,
      user_id: this.user_id,
      title,
      content,
      tags,
      priority,
      created: now,
      updated: now,
    };
  }

  async validateUpdateNote(
    noteId: string,
    updates: {
      title?: string;
      content?: string;
      tags?: string[];
      priority?: 'low' | 'medium' | 'high';
    }
  ): Promise<{ existing: NoteRow; newTitle: string; newContent: string; newTags: string[]; newPriority: 'low' | 'medium' | 'high' }> {
    // First, get the existing note
    const results = await this.db.db.execO<NoteRow>('SELECT * FROM notes WHERE id = ? AND user_id = ?', [noteId, this.user_id]);
    
    if (!results || results.length === 0) {
      throw new Error('Note not found');
    }
    
    const existing = results[0];
    
    // Prepare updated values
    const newTitle = updates.title ?? existing.title;
    const newContent = updates.content ?? existing.content;
    const newTags = updates.tags ?? JSON.parse(existing.tags);
    const newPriority = updates.priority ?? existing.priority;
    
    // Check title + content + tags size (50KB limit)
    const tagsJson = JSON.stringify(newTags);
    const totalSize = new TextEncoder().encode(newTitle + newContent + tagsJson).length;
    if (totalSize > 50 * 1024) {
      throw new Error('Note size exceeds 50KB limit');
    }
    
    return { existing, newTitle, newContent, newTags, newPriority };
  }

  async updateNote(
    noteId: string,
    newTitle: string,
    newContent: string,
    newTags: string[],
    newPriority: 'low' | 'medium' | 'high',
    existingCreated: string
  ): Promise<Note> {
    const now = new Date().toISOString();
    const tagsJson = JSON.stringify(newTags);
    
    await this.db.db.exec(`UPDATE notes
          SET title = ?, content = ?, tags = ?, priority = ?, updated = ?
          WHERE id = ? AND user_id = ?`, [newTitle, newContent, tagsJson, newPriority, now, noteId, this.user_id]);
    
    return {
      id: noteId,
      user_id: this.user_id,
      title: newTitle,
      content: newContent,
      tags: newTags,
      priority: newPriority,
      created: existingCreated,
      updated: now,
    };
  }

  async searchNotes(
    query?: {
      keywords?: string[];
      tags?: string[];
      regexp?: string;
    }
  ): Promise<NoteListItem[]> {
    // Get all notes for the user
    const results = await this.db.db.execO<NoteRow>('SELECT * FROM notes WHERE user_id = ? ORDER BY updated DESC', [this.user_id]);
    
    if (!results) return [];
    
    const notes = results;
    const filteredNotes: NoteListItem[] = [];
    
    for (const note of notes) {
      let matches = true;
      let snippet: string | undefined;
      
      if (query) {
        // Check tags filter
        if (query.tags && query.tags.length > 0) {
          const noteTags = JSON.parse(note.tags);
          const hasMatchingTag = query.tags.some(tag => 
            noteTags.some((noteTag: string) => 
              noteTag.toLowerCase().includes(tag.toLowerCase())
            )
          );
          if (!hasMatchingTag) {
            matches = false;
          }
        }
        
        // Check keywords filter
        if (matches && query.keywords && query.keywords.length > 0) {
          const searchText = (note.title + ' ' + note.content).toLowerCase();
          const hasMatchingKeyword = query.keywords.some(keyword => 
            searchText.includes(keyword.toLowerCase())
          );
          if (!hasMatchingKeyword) {
            matches = false;
          } else {
            // Generate snippet for content matches
            const contentLower = note.content.toLowerCase();
            for (const keyword of query.keywords) {
              const keywordLower = keyword.toLowerCase();
              const index = contentLower.indexOf(keywordLower);
              if (index !== -1) {
                const start = Math.max(0, index - 50);
                const end = Math.min(note.content.length, index + keyword.length + 50);
                snippet = '...' + note.content.slice(start, end) + '...';
                break;
              }
            }
          }
        }
        
        // Check regexp filter
        if (matches && query.regexp) {
          try {
            const regex = new RegExp(query.regexp, 'i');
            const searchText = note.title + ' ' + note.content;
            const regexMatch = regex.exec(searchText);
            if (!regexMatch) {
              matches = false;
            } else {
              // Generate snippet for regex matches in content
              const contentMatch = regex.exec(note.content);
              if (contentMatch) {
                const index = contentMatch.index;
                const start = Math.max(0, index - 50);
                const end = Math.min(note.content.length, index + contentMatch[0].length + 50);
                snippet = '...' + note.content.slice(start, end) + '...';
              }
            }
          } catch {
            throw new Error('Invalid regular expression');
          }
        }
      }
      
      if (matches) {
        filteredNotes.push(rowToNoteListItem(note, snippet));
      }
    }
    
    return filteredNotes;
  }

  async listNotes(
    options?: {
      priority?: 'low' | 'medium' | 'high';
      limit?: number;
      offset?: number;
    }
  ): Promise<NoteListItem[]> {
    let sql = 'SELECT * FROM notes WHERE user_id = ?';
    const args: (string | number)[] = [this.user_id];
    
    if (options?.priority) {
      sql += ' AND priority = ?';
      args.push(options.priority);
    }
    
    sql += ' ORDER BY updated DESC';
    
    if (options?.limit) {
      sql += ' LIMIT ?';
      args.push(options.limit);
      
      if (options?.offset) {
        sql += ' OFFSET ?';
        args.push(options.offset);
      }
    }
    
    const results = await this.db.db.execO<NoteRow>(sql, args);
    
    if (!results) return [];
    
    return results.map(note => rowToNoteListItem(note));
  }

  async getNote(noteId: string): Promise<Note | null> {
    const results = await this.db.db.execO<NoteRow>('SELECT * FROM notes WHERE id = ? AND user_id = ?', [noteId, this.user_id]);
    
    if (!results || results.length === 0) {
      return null;
    }
    
    return rowToNote(results[0]);
  }

  async deleteNote(noteId: string): Promise<boolean> {
    await this.db.db.exec('DELETE FROM notes WHERE id = ? AND user_id = ?', [noteId, this.user_id]);
    
    // Note: cr-sqlite exec doesn't return changes count like better-sqlite3
    // We'll assume the operation succeeded if no error was thrown
    return true;
  }
}
