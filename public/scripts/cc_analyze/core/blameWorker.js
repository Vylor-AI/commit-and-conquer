const { parentPort, workerData } = require("worker_threads");
const { LocalGitAdapter } = require("../git/localGitAdapter");

async function run() {
  try {
    const git = new LocalGitAdapter();
    const ownership = await git.blameFileAtCommit(
      workerData.repoPath,
      workerData.commitHash,
      workerData.filePath
    );

    parentPort.postMessage({ ownership });
  } catch (error) {
    parentPort.postMessage({ error: error.message || String(error) });
  }
}

run();
