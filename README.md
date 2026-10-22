# Plateside

Clients log meals with a photo. AI names the foods and estimates portions. The client corrects anything wrong. The coach sees every client's whole day on one screen, sees who has not logged today, replies to a meal the same day, and gets an AI weekly summary per client.

**Who it is for:** online nutrition coaches and their clients. Coaches advise from food logs, but typing every meal is a chore, so they see half the picture.

## Core flow
1. Client opens the app, enters a name, uploads or takes a photo of the plate.
2. A vision model (Anthropic Claude) returns foods, portion estimates and macros as JSON.
3. Client edits any item and saves. Meal is marked "corrected by client".
4. Coach tab: all clients for today on one screen, not-logged-today flag, per-meal reply, week summary.

## Stack
Static HTML + Vercel serverless functions (`api/index.js`). Data in Vercel Blob (JSON). Images are resized in the browser. AI key is a server-side env var (`ANTHROPIC_API_KEY`), never in the repo.

## Limits (honest)
Portion estimates from a photo are approximate; the correction step exists for that reason. No login yet: the client picks a name. No push notifications.

## Run
`npm i && ANTHROPIC_API_KEY=... npx vercel dev`
