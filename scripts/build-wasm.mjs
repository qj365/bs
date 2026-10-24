// Builds the Rust simulation to WebAssembly and copies it into src/wasm.
// Requires Rust + `rustup target add wasm32-unknown-unknown`.
import { execSync } from 'node:child_process';
import { copyFileSync, statSync } from 'node:fs';

execSync('cargo build --release --target wasm32-unknown-unknown --manifest-path sim/Cargo.toml', { stdio: 'inherit' });
const out = 'src/wasm/ball_sim.wasm';
copyFileSync('sim/target/wasm32-unknown-unknown/release/ball_sim.wasm', out);
console.log(`→ ${out} (${(statSync(out).size / 1024).toFixed(1)} KB)`);
