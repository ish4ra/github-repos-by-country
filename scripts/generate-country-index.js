import { writeRankingsIndex } from '../src/output.js';

const indexPath = await writeRankingsIndex();
console.log(`Generated global rankings index: ${indexPath}`);
