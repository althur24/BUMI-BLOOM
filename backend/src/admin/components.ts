import { ComponentLoader } from "adminjs";

// AdminJS compiles custom frontend components via its own bundler. We keep one
// loader for the whole app and reference components from resources.ts.
const componentLoader = new ComponentLoader();

export const Components = {
  UploadField: componentLoader.add("UploadField", "./components/upload-field"),
};

export { componentLoader };
