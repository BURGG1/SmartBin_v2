import BASE_URL from "../config";

const API_BASE = `${BASE_URL}/api/rewards`;

async function readResponse(res, fallbackMessage) {
  let json;

  try {
    json = await res.json();
  } catch {
    throw new Error(fallbackMessage);
  }

  if (!res.ok || json?.success === false) {
    throw new Error(json?.message || fallbackMessage);
  }

  return json;
}

export async function getRewards() {
  const res = await fetch(API_BASE);
  const json = await readResponse(res, "Failed to fetch rewards.");

  return Array.isArray(json) ? json : json.data ?? [];
}

export async function createReward({
  name,
  points,
  stocks,
  imageFile,
  claimLimit = 0,
  claimPeriod = "month",
}) {
  const formData = new FormData();

  formData.append("name", name);
  formData.append("points", String(points));
  formData.append("stocks", String(stocks));
  formData.append("claimLimit", String(claimLimit));
  formData.append("claimPeriod", claimPeriod);

  if (imageFile) {
    formData.append("image", imageFile);
  }

  const res = await fetch(API_BASE, {
    method: "POST",
    body: formData,
  });

  const json = await readResponse(res, "Failed to create reward.");
  return json.data ?? json;
}

export async function updateReward(
  id,
  {
    name,
    points,
    stocks,
    imageFile,
    claimLimit,
    claimPeriod,
  }
) {
  const formData = new FormData();

  if (name !== undefined) formData.append("name", name);
  if (points !== undefined) formData.append("points", String(points));
  if (stocks !== undefined) formData.append("stocks", String(stocks));

  if (claimLimit !== undefined) {
    formData.append("claimLimit", String(claimLimit));
  }

  if (claimPeriod !== undefined) {
    formData.append("claimPeriod", claimPeriod);
  }

  if (imageFile) {
    formData.append("image", imageFile);
  }

  const res = await fetch(`${API_BASE}/${id}`, {
    method: "PUT",
    body: formData,
  });

  const json = await readResponse(res, "Failed to update reward.");
  return json.data ?? json;
}

export async function deleteReward(id) {
  const res = await fetch(`${API_BASE}/${id}`, {
    method: "DELETE",
  });

  return readResponse(res, "Failed to delete reward.");
}