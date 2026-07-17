import AdminJS from "adminjs";
import { Database, Resource } from "@adminjs/prisma";
import { buildResources } from "./admin/resources.js";
import { componentLoader } from "./admin/components.js";

AdminJS.registerAdapter({ Database, Resource });

export const admin = new AdminJS({
  rootPath: "/admin",
  resources: buildResources(),
  componentLoader,
  branding: {
    companyName: "Bumi & Bloom",
    withMadeWithLove: false,
    theme: {
      colors: {
        primary100: "#3a5a40",
      },
    },
  },
});
