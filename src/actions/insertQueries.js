import { pool } from "../lib/mysqlPool.js";

function formatDate(date) {
  if (date instanceof Date) {
    return date.toISOString().slice(0, 10); // YYYY-MM-DD
  }

  if (typeof date === "string") {
    const [dd, mm, yyyy] = date.split("/");
    return `${yyyy}-${mm}-${dd}`;
  }

  throw new Error("Invalid date format");
}

export const insertData = async (invoices) => {

    const conn = await pool.getConnection();

    try {
        await conn.beginTransaction();

        for (const invoice of invoices) {

            let [customer] = await conn.query(
                `SELECT code FROM Acm WHERE name = ?`,
                [invoice.name]
            );

            let Acno;

            if (customer.length === 0) {
                const [result] = await conn.query(
                    `INSERT INTO Acm (name, address, address1, address2, telephone, GSTNo, DLNO, DLNO1)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                    [
                        invoice.name,
                        invoice.address,
                        invoice.address1,
                        invoice.address2,
                        invoice["Tel"],
                        invoice["GST No."],
                        invoice.DLNO,
                        invoice.DLNO1,
                    ]
                );
                Acno = result.insertId;
            } else {
                Acno = customer[0].code;
            }

            const [existing] = await conn.query(
                `SELECT id FROM Salepurchase1 WHERE Vno=? AND Vtyp=?`,
                [invoice.VNo, invoice.Vtyp]
            );

            if (existing.length > 0) continue;

            const [invoiceResult] = await conn.query(
                `INSERT IGNORE INTO Salepurchase1 
                (Acno, Vno, GSTVno, Vdt, Vtyp, NoOfItem, Uid, Ouid, mTime, Amt01, disamtit, Taxamt, Rndamt)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    Acno,
                    invoice.VNo,
                    invoice["Bill No"],
                    formatDate(invoice.Dated),
                    invoice.Vtyp,
                    invoice["No Of Items"],
                    invoice["Made By"],
                    invoice["Print By"],
                    invoice["Make Time"],
                    invoice["Taxable Amt."],
                    invoice["Disc. Amt"],
                    invoice["Tax Amt"],
                    invoice["Inv Amt"] - invoice["Net Amount"],
                ]
            );

            const invoiceId = invoiceResult.insertId;

            if(!invoiceId) {
                console.error(`Dublicate entry found for invoice VNo: ${invoice.VNo}, Vtyp: ${invoice.Vtyp}. Skipping insertion.`);
                continue;
            }
            for (const item of invoice.items) {

                let [product] = await conn.query(
                    `SELECT code FROM Item WHERE name=? AND Compname=?`,
                    [item["PARTICULARS"], item["COMPANY"]]
                );

                let Itemc;

                if (product.length === 0) {
                    const [prodResult] = await conn.query(
                        `INSERT INTO Item (name, Pack, Compname, HSNCode)
                        VALUES (?, ?, ?, ?)`,
                        [
                            item["PARTICULARS"],
                            item["PACK"],
                            item["COMPANY"],
                            item["HSN CODE"],
                        ]
                    );
                    Itemc = prodResult.insertId;
                } else {
                    Itemc = product[0].code;
                }

                let CGST = 0, SGST = 0, IGST = 0;

                if (item.Tax === 2.5 || item.Tax === 6 || item.Tax === 9) {
                    CGST = item.Tax;
                    SGST = item.Tax;
                } else {
                    IGST = item.Tax;
                }

                await conn.query(
                    `INSERT INTO Salepurchase2 
                    (invoice_id, Vno, Vtype, Vdt, Itemc, Qty, HSNCode, Batch, expiry, Mrp, Ftrate, Dis, CGST, SGST, IGST)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [
                        invoiceId,
                        invoice.VNo,
                        invoice.Vtyp,
                        formatDate(invoice.Dated),
                        Itemc,
                        item.Qty,
                        item["HSN CODE"],
                        item["Batch No."],
                        item["Exp."],
                        item["MRP."],
                        item["Rate"],
                        item["DIS%"],
                        CGST,
                        SGST,
                        IGST
                    ]
                );
            }
        }
        await conn.commit();

    } catch (err) {
        if (conn) await conn.rollback();
        console.error(err);
        throw err;
    } finally {
        if (conn) conn.release();
    }
}

export const insertResolvedInvoice = async (invoice, items) => {

    const conn = await pool.getConnection();

    try {
        await conn.beginTransaction();

        await conn.query(
            `DELETE FROM Salepurchase2 WHERE 
            Vno = ? AND Vtype = ? AND Vdt = ?`,
            [invoice.VNo, invoice.Vtyp, formatDate(invoice.Dated)]
        );

        await conn.query(
            `DELETE FROM Salepurchase1 WHERE GSTVno = ?`,
            [invoice["Bill No"]]
        );

        let [customer] = await conn.query(
            `SELECT code FROM Acm WHERE name = ?`,
            [invoice.name]
        );

        let Acno;

        if (customer.length === 0) {
            throw new Error(`Customer ${invoice.name} not found in database`);
        }

        Acno = customer[0].code;

        const [invoiceResult] = await conn.query(
            `INSERT INTO Salepurchase1 
            (Acno, Vno, GSTVno, Vdt, Vtyp, NoOfItem, Uid, Ouid, mTime, Amt01, disamtit, Taxamt, Rndamt, status, discrepancy)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                Acno,
                invoice.VNo,
                invoice["Bill No"],
                formatDate(invoice.Dated),
                invoice.Vtyp,
                invoice["No Of Items"],
                invoice["Made By"],
                invoice["Print By"],
                invoice["Make Time"],
                invoice["Taxable Amt."],
                invoice["Disc. Amt"],
                invoice["Tax Amt"],
                invoice["Inv Amt"] - invoice["Net Amount"],
                2,
                2
            ]
        );

        const invoiceId = invoiceResult.insertId;

        for (const item of items) {

            let [product] = await conn.query(
                `SELECT code FROM Item WHERE name=? AND Compname=?`,
                [item["PARTICULARS"], item["COMPANY"]]
            );

            let Itemc;

            if (product.length === 0) {
                throw new Error(`Product ${item["PARTICULARS"]} not found in database`);
            } else {
                Itemc = product[0].code;
            }

            let CGST = 0, SGST = 0, IGST = 0;

            if (item.Tax === 2.5 || item.Tax === 6 || item.Tax === 9) {
                CGST = item.Tax;
                SGST = item.Tax;
            } else {
                IGST = item.Tax;
            }

            await conn.query(
                `INSERT INTO Salepurchase2 
                    (invoice_id, Vno, Vtype, Vdt, Itemc, Qty, HSNCode, Batch, expiry, Mrp, Ftrate, Dis, CGST, SGST, IGST)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    invoiceId,
                    invoice.VNo,
                    invoice.Vtyp,
                    formatDate(invoice.Dated),
                    Itemc,
                    item.Qty,
                    item["HSN CODE"],
                    item["Batch No."],
                    item["Exp."],
                    item["MRP."],
                    item["Rate"],
                    item["DIS%"],
                    CGST,
                    SGST,
                    IGST
                ]
            );
        }

        console.log(`Invoice ${invoice["Bill No"]} resolved and inserted successfully`);

        await conn.query(`
            UPDATE discrepancy_table set status = 10, discrepancy = 2 where GSTVno = '${invoice["Bill No"]}'; 
        `);

        await conn.commit();

    } catch (err) {
        if (conn) await conn.rollback();
        console.error(err);
        throw err;
    } finally {
        if (conn) conn.release();
    }
}