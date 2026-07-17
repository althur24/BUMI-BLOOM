import fs from "node:fs";
import { Prisma } from "@prisma/client";
import { prisma } from "../db.js";
import { uploadToBucket, getPublicUrl, buildStoragePath } from "../storage.js";
import { Components } from "./components.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

// @adminjs/prisma v5 expects { model: DMMFModel, client: PrismaClient }.
// model comes from Prisma.dmmf.datamodel.models, client is the PrismaClient instance.
const dmmfModels = Prisma.dmmf.datamodel.models;

const res = (modelName: string, options: Record<string, any> = {}) => {
  const model = dmmfModels.find((m) => m.name.toLowerCase() === modelName.toLowerCase());
  if (!model) throw new Error(`DMMF model "${modelName}" not found`);
  return {
    resource: { model, client: prisma },
    options,
  };
};

// Custom action: upload a file to Supabase Storage and create a MediaAsset.
const uploadImageAction = {
  actionType: "resource",
  name: "uploadImage",
  label: "Upload image",
  icon: "Upload",
  component: Components.UploadField,
  handler: async (request: any) => {
    const payload: Record<string, any> = request.payload ?? {};
    const file: { path?: string; name?: string; type?: string } | undefined = payload.file;
    if (!file || !file.path) {
      return { notice: { message: "No file provided", type: "error" } };
    }
    const buf = await fs.promises.readFile(file.path);
    const storagePath = buildStoragePath(file.name ?? "upload");
    await uploadToBucket("products", storagePath, buf, file.type ?? "image/png");
    const publicUrl = getPublicUrl("products", storagePath);
    const asset = await prisma.mediaAsset.create({
      data: {
        bucket: "products",
        storagePath,
        publicUrl,
        fileName: file.name ?? storagePath,
        mimeType: file.type ?? "image/png",
        type: "IMAGE",
        altText: typeof payload.altText === "string" && payload.altText ? payload.altText : null,
      },
    });
    return {
      redirectUrl: `/admin/resources/MediaAsset/records/${asset.id}/show`,
      notice: { message: "Image uploaded", type: "success" },
    };
  },
};

export const buildResources = () => [
  res("brand", {
    listProperties: ["name", "slug", "audience", "status", "isFeatured", "sortOrder"],
    filterProperties: ["name", "slug", "audience", "status"],
    editProperties: [
      "name", "slug", "city", "country", "audience", "website", "instagram", "tiktok",
      "shortDesc", "description", "logoAsset", "isFeatured", "sortOrder", "status",
    ],
    showProperties: [
      "name", "slug", "city", "country", "audience", "website", "shortDesc", "description",
      "logoAsset", "isFeatured", "status",
    ],
  }),

  res("category", {
    listProperties: ["name", "slug", "parentId", "menuVisible", "homeVisible", "sortOrder", "status"],
    editProperties: [
      "name", "slug", "parent", "description", "imageAsset", "menuVisible", "homeVisible",
      "sortOrder", "status",
    ],
  }),

  res("product", {
    listProperties: [
      "name", "slug", "brand", "audience", "category", "priceAudCents", "badge", "status",
    ],
    filterProperties: ["name", "brand", "audience", "category", "badge", "status", "isNew", "isBestseller"],
    editProperties: [
      "name", "slug", "brand", "audience", "category", "categories",
      "fibre", "material", "description",
      "priceAudCents", "compareAtAudCents", "costAudCents", "currency",
      "badge", "isNew", "isBestseller", "rating", "reviewsCount", "addedAtRank",
      "colors", "variants", "images", "collections", "status",
    ],
    showProperties: [
      "name", "slug", "brand", "audience", "category", "categories", "fibre", "material",
      "description", "priceAudCents", "compareAtAudCents", "badge", "rating", "reviewsCount",
      "colors", "variants", "images", "collections", "status",
    ],
  }),

  res("productColor", {
    listProperties: ["product", "name", "hex", "sortOrder"],
    editProperties: ["product", "name", "hex", "sortOrder"],
  }),

  res("productVariant", {
    listProperties: ["product", "color", "size", "sku", "stock", "lowStockThreshold"],
    filterProperties: ["product", "size", "sku"],
    editProperties: [
      "product", "color", "size", "sku", "barcode",
      "stock", "lowStockThreshold", "priceOverrideAudCents", "weightGrams",
    ],
  }),

  res("productImage", {
    listProperties: ["product", "asset", "altText", "sortOrder", "isPrimary"],
    editProperties: ["product", "asset", "altText", "sortOrder", "isPrimary"],
  }),

  res("mediaAsset", {
    listProperties: ["fileName", "bucket", "publicUrl", "type", "altText"],
    filterProperties: ["bucket", "type"],
    editProperties: [
      "bucket", "storagePath", "publicUrl", "fileName", "mimeType",
      "width", "height", "sizeBytes", "type", "altText", "tags",
    ],
    showProperties: [
      "fileName", "bucket", "storagePath", "publicUrl", "mimeType", "width", "height",
      "sizeBytes", "type", "altText", "tags",
    ],
    actions: {
      // Custom in-admin uploader → Supabase Storage. (Fallback: standard "new" with a publicUrl.)
      uploadImage: {
        actionType: "resource",
        name: "uploadImage",
        label: "Upload image",
        icon: "Upload",
        component: Components.UploadField,
        handler: uploadImageAction.handler,
      },
    },
  }),

  res("collection", {
    listProperties: ["name", "slug", "kind", "sortOrder", "status"],
    filterProperties: ["slug", "status"],
    editProperties: ["name", "slug", "kind", "description", "imageAsset", "products", "sortOrder", "status"],
    showProperties: ["name", "slug", "kind", "description", "products", "status"],
  }),

  res("promotion", {
    listProperties: ["code", "label", "type", "value", "isActive", "startsAt", "endsAt"],
    filterProperties: ["code", "type", "isActive"],
    editProperties: [
      "code", "label", "type", "value", "currency",
      "startsAt", "endsAt", "usageLimit", "isActive",
    ],
  }),

  // Admin users — only Super Admins should manage other admins. Falls open only
  // if currentAdmin isn't populated by the auth layer (see README).
  res("adminUser", {
    listProperties: ["email", "name", "role", "isActive", "lastLoginAt"],
    filterProperties: ["email", "role", "isActive"],
    editProperties: ["email", "name", "role", "isActive"],
    actions: {
      new: { isAccessible: ({ currentAdmin }: any) => !currentAdmin || currentAdmin.role === "SUPER_ADMIN" },
      edit: { isAccessible: ({ currentAdmin }: any) => !currentAdmin || currentAdmin.role === "SUPER_ADMIN" },
      delete: { isAccessible: ({ currentAdmin }: any) => !currentAdmin || currentAdmin.role === "SUPER_ADMIN" },
    },
  }),

  // Audit log is read-only.
  res("auditLog", {
    listProperties: ["createdAt", "actorEmail", "action", "entity", "entityId"],
    filterProperties: ["actorEmail", "action", "entity"],
    actions: {
      new: { isAccessible: false },
      edit: { isAccessible: false },
      delete: { isAccessible: false },
      bulkDelete: { isAccessible: false },
    },
  }),
];
