const dependency=require('../packages/rosa-backend/dependencies.cjs');
const Database=dependency('better-sqlite3');new Database(':memory:').close();
const ivm=dependency('isolated-vm');new ivm.Isolate({memoryLimit:10}).dispose();
const duckdb=dependency('duckdb');const db=new duckdb.Database(':memory:',error=>{if(error)throw error;db.close(()=>console.log('V8, SQLite, DuckDB native runtime ready.'));});
