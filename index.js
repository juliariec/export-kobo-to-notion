require("dotenv").config();
const { NOTION_TOKEN, NOTION_DATABASE_ID } = process.env;
const { Client } = require("@notionhq/client");
const notion = new Client({ auth: NOTION_TOKEN });
const db = require("better-sqlite3")("highlights.sqlite");

async function exportHighlights() {
  const getBookListQuery =
    "SELECT DISTINCT content.ContentId, content.Title, content.Attribution AS Author " +
    "FROM Bookmark INNER JOIN content " +
    "ON Bookmark.VolumeID = content.ContentID " +
    "ORDER BY content.Title";
  const bookList = db.prepare(getBookListQuery).all();

  for (book of bookList) {
    try {
      // Removes subtitles from book title
      if (book.Title.indexOf(":") !== -1) {
        book.Title = book.Title.substring(0, book.Title.indexOf(":"));
      }
      let title = book.Title,
        author = book.Author;

      // Check Notion database for the book
      const response = await notion.databases.query({
        database_id: NOTION_DATABASE_ID,
        filter: {
          and: [
            { property: "Title", text: { contains: title } },
            { property: "Highlights", checkbox: { equals: false } },
          ],
        },
      });

      // Find the ID of the relevant book
      var pageId = undefined;
      if (response.results.length === 1) {
        pageId = response.results[0].id;
      } else if (response.results.length > 1) {
        const authorMatch = response.results.filter(
          (r) => r.properties.Author.rich_text[0].plain_text === author
        );
        if (authorMatch.length === 1) pageId = authorMatch[0].id;
        else console.log(`${title} matched multiple items.`);
      } else {
        console.log(`${title} was skipped.`);
      }

      if (pageId) {
        var blocks = [];

        // Retrieves highlights for the book
        const getHighlightsQuery =
          "SELECT Bookmark.Text FROM Bookmark INNER JOIN content ON Bookmark.VolumeID = content.ContentID " +
          "WHERE content.ContentID = ? " +
          "ORDER BY content.DateCreated DESC";
        const highlightsList = db
          .prepare(getHighlightsQuery)
          .all(book.ContentID);

        // Starts with a block for the heading
        blocks.push({
          object: "block",
          type: "heading_1",
          heading_1: {
            text: [{ type: "text", text: { content: "Highlights" } }],
          },
        });

        // Generates a text block for each highlight
        for (highlight of highlightsList) {
          if (highlight.Text !== null) {
            blocks.push({
              object: "block",
              type: "paragraph",
              paragraph: {
                text: [{ type: "text", text: { content: highlight.Text } }],
              },
            });
          }
        }

        // Appends the blocks to the book page
        await notion.blocks.children.append({
          block_id: pageId,
          children: blocks,
        });

        // Updates the status of the book page
        await notion.pages.update({
          page_id: pageId,
          properties: { Highlights: { checkbox: true } },
        });

        console.log(`Uploaded highlights for ${title}.`);
      }
    } catch (error) {
      console.log(`Error with ${book.Title}: `, error);
    }
  }
}

exportHighlights();
