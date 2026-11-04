The 33,684-byte `color.copc.laz` fixture is PDAL's `test/data/copc/1.2-with-color.copc.laz`:
https://github.com/PDAL/PDAL/blob/master/test/data/copc/1.2-with-color.copc.laz

SHA-256: `c94fa8dfe14ce7bff074231ce9e8aa36f7200342a4ff675c2902205f40e72728`.
PDAL is distributed under BSD-3-Clause: https://github.com/PDAL/PDAL/blob/master/LICENSE.txt.

The browser check imports STEP / IGES samples directly from the pinned `occt-import-js` dependency; those files are not duplicated in this repository:
https://github.com/kovacsv/occt-import-js/tree/main/test/testfiles
The package's license and Open Cascade exception are in its `LICENSE.md`:
https://github.com/kovacsv/occt-import-js/blob/main/LICENSE.md

The check uses actual OCCT and LAZ WebAssembly workers, the Vite server's HTTP byte range support, and a real WebGL renderer. No application files or sessions are modified.
