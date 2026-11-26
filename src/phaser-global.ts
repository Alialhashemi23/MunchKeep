// In the published single-file build, Phaser comes from a CDN <script> as a global.
const PhaserGlobal = (window as unknown as { Phaser: typeof import('phaser') }).Phaser;
export default PhaserGlobal;
